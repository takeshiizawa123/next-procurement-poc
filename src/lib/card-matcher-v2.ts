/**
 * カード照合エンジン v2 — office_member_id ベース + 契約マスタ照合
 *
 * v1 (card-matcher.ts) との違い:
 * - card_last4 に依存しない（MF経費の office_member_id で従業員特定）
 * - Supabase Postgres (Drizzle) から予測テーブル取得
 * - 購買・出張・立替を統一管理（type enum で区別）
 * - Stage 1 仕訳情報（MF経費の dr_excise 等）を活用
 *
 * 照合の基本方針:
 *   A) 予測照合: MF経費カード明細 × predicted_transactions
 *   B) 契約照合: MF経費カード明細 × contracts(billing_type='カード自動')
 *      ↓ supplierName 類似度でスコアリング
 *      ↓ 契約期間内を検証
 *      ↓ 月別集約 → contract_invoices 自動作成
 */

import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { predictedTransactions, employees, contracts, contractInvoices } from "@/db/schema";
import type { NormalizedCardStatement } from "./mf-expense";

// ============================================================================
// 型定義
// ============================================================================

export type MatchStatus = "confident" | "candidate" | "unmatched" | "unreported";

export interface MatchResult {
  /** カード明細側のID (mf_ex_transaction_id) */
  statementId: string;
  /** 紐付いた予測ID (matched な場合のみ) */
  predictionId: string | null;
  /** マッチ判定 */
  status: MatchStatus;
  /** スコア（0-100） */
  score: number;
  /** 金額差（実額 - 予測額） */
  amountDiff: number;
  /** 日付差（日数、絶対値） */
  dateDiff: number;
  /** マッチ理由 */
  reason: string;
  /** カード明細 */
  statement: NormalizedCardStatement;
}

export interface MatchSummary {
  total: number;
  confident: number;
  candidate: number;
  unmatched: number;
  unreported: number;
  results: MatchResult[];
}

// ============================================================================
// 照合ロジック
// ============================================================================

/**
 * 金額一致度スコア（0-60点）
 * 完全一致=60, ±1%=55, ±5%=40, ±10%=20, それ以上=0
 */
function amountScore(expected: number, actual: number): number {
  if (expected === 0) return 0;
  const diff = Math.abs(actual - expected);
  const ratio = diff / expected;
  if (diff === 0) return 60;
  if (ratio <= 0.01) return 55;
  if (ratio <= 0.05) return 40;
  if (ratio <= 0.10) return 20;
  return 0;
}

/**
 * 日付近さスコア（0-30点）
 * 同日=30, ±1日=25, ±3日=15, ±7日=5, それ以上=0
 */
function dateScore(expectedDate: string, actualDate: string): { score: number; days: number } {
  const e = new Date(expectedDate).getTime();
  const a = new Date(actualDate).getTime();
  if (isNaN(e) || isNaN(a)) return { score: 0, days: 999 };
  const days = Math.abs(Math.round((a - e) / (24 * 60 * 60 * 1000)));
  let score = 0;
  if (days === 0) score = 30;
  else if (days <= 1) score = 25;
  else if (days <= 3) score = 15;
  else if (days <= 7) score = 5;
  return { score, days };
}

/**
 * サービス名/加盟店名の類似度スコア（0-10点）
 * 完全一致=10, 部分一致=7, 無関係=0
 */
function supplierScore(expected: string, actualRemark: string): number {
  if (!expected || !actualRemark) return 0;
  const e = expected.toLowerCase();
  const a = actualRemark.toLowerCase();
  if (a === e) return 10;
  if (a.includes(e) || e.includes(a)) return 7;
  // bigram 部分一致
  const bigrams = (s: string) => {
    const arr: string[] = [];
    for (let i = 0; i < s.length - 1; i++) arr.push(s.slice(i, i + 2));
    return new Set(arr);
  };
  const eb = bigrams(e);
  const ab = bigrams(a);
  let common = 0;
  for (const b of eb) if (ab.has(b)) common++;
  if (eb.size === 0) return 0;
  const overlap = common / eb.size;
  if (overlap >= 0.5) return 5;
  if (overlap >= 0.3) return 3;
  return 0;
}

/**
 * office_member_id × 金額 × 日付 でマッチング実行
 *
 * @param statements MF経費から取得したカード明細（NormalizedCardStatement[]）
 * @param options 検索オプション
 * @returns マッチング結果
 */
export async function matchByOfficeMember(
  statements: NormalizedCardStatement[],
  options: {
    /** 予測の予測日から何日前〜後まで対象とするか（デフォルト: 前後7日） */
    dateWindowDays?: number;
    /** 自動承認の最低スコア（デフォルト: 80） */
    confidentThreshold?: number;
    /** 候補として扱う最低スコア（デフォルト: 50） */
    candidateThreshold?: number;
  } = {},
): Promise<MatchSummary> {
  const dateWindow = options.dateWindowDays ?? 7;
  const confidentTh = options.confidentThreshold ?? 80;
  const candidateTh = options.candidateThreshold ?? 50;

  const results: MatchResult[] = [];
  const usedPredictionIds = new Set<string>();

  for (const stmt of statements) {
    // 1. MF経費側で既に手動入力（立替精算）の場合はスキップ
    //    これらは購買管理システムの照合対象外
    if (stmt.source === "manual" || stmt.source === "input_done") {
      results.push({
        statementId: stmt.mfExTransactionId,
        predictionId: null,
        status: "unreported",
        score: 0,
        amountDiff: 0,
        dateDiff: 0,
        reason: `MF経費で手動入力済み (${stmt.source}) — 照合対象外`,
        statement: stmt,
      });
      continue;
    }

    // 2. 該当従業員の pending な予測を取得
    //    日付範囲で絞り込み
    const fromDate = new Date(new Date(stmt.date).getTime() - dateWindow * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const toDate = new Date(new Date(stmt.date).getTime() + dateWindow * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const candidates = await db
      .select()
      .from(predictedTransactions)
      .where(
        and(
          eq(predictedTransactions.mfOfficeMemberId, stmt.officeMemberId),
          eq(predictedTransactions.status, "pending"),
          gte(predictedTransactions.predictedDate, fromDate),
          lte(predictedTransactions.predictedDate, toDate),
        ),
      );

    // 3. 既に他の明細で使用されていない予測のみ対象
    const unused = candidates.filter((p) => !usedPredictionIds.has(p.id));

    if (unused.length === 0) {
      // 従業員特定できているが予測がない → 未申請利用
      results.push({
        statementId: stmt.mfExTransactionId,
        predictionId: null,
        status: "unreported",
        score: 0,
        amountDiff: 0,
        dateDiff: 0,
        reason: `申請なしのカード利用 (${stmt.memberName})`,
        statement: stmt,
      });
      continue;
    }

    // 4. スコアリング
    const scored = unused.map((pred) => {
      const aScore = amountScore(pred.predictedAmount, stmt.amount);
      const { score: dScore, days } = dateScore(pred.predictedDate, stmt.date);
      const sScore = supplierScore(pred.supplier ?? "", stmt.remark);
      const total = aScore + dScore + sScore;
      return {
        pred,
        total,
        aScore,
        dScore,
        sScore,
        days,
        amountDiff: stmt.amount - pred.predictedAmount,
      };
    });

    scored.sort((a, b) => b.total - a.total);
    const best = scored[0];

    if (best.total >= confidentTh && scored.length === 1) {
      // 単一候補で高スコア → 自動確定
      results.push({
        statementId: stmt.mfExTransactionId,
        predictionId: best.pred.id,
        status: "confident",
        score: best.total,
        amountDiff: best.amountDiff,
        dateDiff: best.days,
        reason: `完全一致 (金額=${best.aScore}, 日付=${best.dScore}, サービス=${best.sScore})`,
        statement: stmt,
      });
      usedPredictionIds.add(best.pred.id);
    } else if (best.total >= candidateTh) {
      // 中スコア or 複数候補 → 手動確認
      results.push({
        statementId: stmt.mfExTransactionId,
        predictionId: best.pred.id,
        status: "candidate",
        score: best.total,
        amountDiff: best.amountDiff,
        dateDiff: best.days,
        reason: `候補マッチ (スコア=${best.total}, 候補数=${scored.length})`,
        statement: stmt,
      });
    } else {
      results.push({
        statementId: stmt.mfExTransactionId,
        predictionId: null,
        status: "unmatched",
        score: best.total,
        amountDiff: best.amountDiff,
        dateDiff: best.days,
        reason: `マッチ候補なし (最高スコア=${best.total})`,
        statement: stmt,
      });
    }
  }

  const summary: MatchSummary = {
    total: results.length,
    confident: results.filter((r) => r.status === "confident").length,
    candidate: results.filter((r) => r.status === "candidate").length,
    unmatched: results.filter((r) => r.status === "unmatched").length,
    unreported: results.filter((r) => r.status === "unreported").length,
    results,
  };

  return summary;
}

/**
 * マッチング結果をDBに確定反映
 * status=confident のものは自動で予測テーブルを matched に更新
 */
export async function applyConfidentMatches(results: MatchResult[]): Promise<number> {
  let updated = 0;
  for (const r of results) {
    if (r.status !== "confident" || !r.predictionId) continue;
    await db
      .update(predictedTransactions)
      .set({
        status: "matched",
        matchedAt: new Date(),
        amountDiff: r.amountDiff,
        mfExTransactionId: r.statementId,
      })
      .where(eq(predictedTransactions.id, r.predictionId));
    updated++;
  }
  return updated;
}

/**
 * 未マッチ明細の従業員名一覧を取得（unreported alert用）
 */
export async function getUnreportedByMember(results: MatchResult[]): Promise<
  { memberName: string; officeMemberId: string; count: number; totalAmount: number }[]
> {
  const map = new Map<
    string,
    { memberName: string; officeMemberId: string; count: number; totalAmount: number }
  >();
  for (const r of results) {
    if (r.status !== "unreported") continue;
    const key = r.statement.officeMemberId;
    const entry = map.get(key) ?? {
      memberName: r.statement.memberName,
      officeMemberId: key,
      count: 0,
      totalAmount: 0,
    };
    entry.count++;
    entry.totalAmount += r.statement.amount;
    map.set(key, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.totalAmount - a.totalAmount);
}

// ============================================================================
// 契約マスタ照合（billing_type='カード自動'）
// ============================================================================

export interface ContractMatchResult {
  /** カード明細ID */
  statementId: string;
  /** マッチした契約ID */
  contractId: number | null;
  /** 契約番号 */
  contractNumber: string | null;
  /** 請求月 (YYYY-MM) */
  billingMonth: string;
  /** マッチ判定 */
  status: "confident" | "candidate" | "unmatched";
  /** スコア (0-100) */
  score: number;
  /** マッチ理由 */
  reason: string;
  /** カード明細 */
  statement: NormalizedCardStatement;
}

export interface ContractAggregate {
  contractId: number;
  contractNumber: string;
  supplierName: string;
  billingMonth: string;
  /** マッチした明細数 */
  matchedCount: number;
  /** 合計金額 */
  totalAmount: number;
  /** 契約の月額/予算額 */
  budgetAmount: number | null;
  /** 予算超過額（totalAmount - budgetAmount、超過時のみ正値） */
  overBudget: number | null;
}

export interface ContractMatchSummary {
  total: number;
  confident: number;
  candidate: number;
  unmatched: number;
  /** 契約×月ごとの集約 */
  aggregates: ContractAggregate[];
  results: ContractMatchResult[];
}

/**
 * 契約照合用のサービス名スコア（0-70点）
 * 予測照合より重み高め（契約照合では加盟店名が主キー）
 */
export function contractSupplierScore(contractName: string, cardRemark: string): number {
  if (!contractName || !cardRemark) return 0;
  const c = contractName.toLowerCase().replace(/[\s　・]/g, "");
  const r = cardRemark.toLowerCase().replace(/[\s　・]/g, "");
  if (r === c) return 70;
  if (r.includes(c) || c.includes(r)) return 60;
  // bigram 類似度
  const bigrams = (s: string) => {
    const arr: string[] = [];
    for (let i = 0; i < s.length - 1; i++) arr.push(s.slice(i, i + 2));
    return new Set(arr);
  };
  const cb = bigrams(c);
  const rb = bigrams(r);
  if (cb.size === 0 || rb.size === 0) return 0;
  let common = 0;
  for (const b of cb) if (rb.has(b)) common++;
  const overlap = common / Math.max(cb.size, rb.size);
  if (overlap >= 0.6) return 45;
  if (overlap >= 0.4) return 30;
  if (overlap >= 0.25) return 15;
  return 0;
}

/**
 * 契約期間内スコア（0-20点）
 */
export function contractPeriodScore(
  startDate: string,
  endDate: string | null,
  transactionDate: string,
): number {
  const tx = new Date(transactionDate).getTime();
  const start = new Date(startDate).getTime();
  if (isNaN(tx) || isNaN(start)) return 0;
  if (tx < start) return 0;
  if (endDate) {
    const end = new Date(endDate).getTime();
    if (!isNaN(end) && tx > end) return 0;
  }
  return 20;
}

/**
 * 金額妥当性スコア（0-10点）
 * 予算額/月額に対して明細金額が妥当な範囲内か
 */
export function contractAmountScore(
  budget: number | null,
  monthly: number | null,
  stmtAmount: number,
): number {
  const ref = budget ?? monthly;
  if (!ref || ref <= 0) return 5; // 基準額なし → 中立点
  if (stmtAmount <= ref) return 10;
  if (stmtAmount <= ref * 1.1) return 7; // 10%以内の超過
  if (stmtAmount <= ref * 1.5) return 3; // 50%以内の超過
  return 0;
}

/**
 * カード明細 × 契約マスタ（billing_type='カード自動'）照合
 *
 * @param statements MF経費カード明細
 * @param options 照合オプション
 */
export async function matchContractCards(
  statements: NormalizedCardStatement[],
  options: {
    confidentThreshold?: number;
    candidateThreshold?: number;
  } = {},
): Promise<ContractMatchSummary> {
  const confidentTh = options.confidentThreshold ?? 75;
  const candidateTh = options.candidateThreshold ?? 45;

  // 1. カード自動の有効な契約を取得
  const activeContracts = await db
    .select()
    .from(contracts)
    .where(
      and(
        eq(contracts.billingType, "カード自動"),
        eq(contracts.isActive, true),
      ),
    );

  if (activeContracts.length === 0) {
    return { total: 0, confident: 0, candidate: 0, unmatched: 0, aggregates: [], results: [] };
  }

  const results: ContractMatchResult[] = [];

  // 2. source="automatic" の明細のみ対象（手動入力は予測照合側で処理）
  const autoStatements = statements.filter(
    (s) => s.source !== "manual" && s.source !== "input_done",
  );

  for (const stmt of autoStatements) {
    const billingMonth = stmt.date.slice(0, 7); // YYYY-MM

    // 各契約に対してスコアリング
    const scored = activeContracts.map((contract) => {
      const sScore = contractSupplierScore(contract.supplierName, stmt.remark);
      const pScore = contractPeriodScore(
        contract.contractStartDate,
        contract.contractEndDate,
        stmt.date,
      );
      const aScore = contractAmountScore(
        contract.budgetAmount,
        contract.monthlyAmount,
        stmt.amount,
      );
      const total = sScore + pScore + aScore;
      return { contract, total, sScore, pScore, aScore };
    });

    scored.sort((a, b) => b.total - a.total);
    const best = scored[0];

    // 期間外(pScore=0)の場合は加盟店名が一致してもマッチしない
    if (best.pScore === 0 || best.total < candidateTh) {
      results.push({
        statementId: stmt.mfExTransactionId,
        contractId: null,
        contractNumber: null,
        billingMonth,
        status: "unmatched",
        score: best.total,
        reason: best.pScore === 0
          ? `契約期間外 (最高スコア=${best.total}, 取引先=${best.contract.supplierName})`
          : `マッチ候補なし (最高スコア=${best.total})`,
        statement: stmt,
      });
      continue;
    }

    // 複数の高スコア契約がある場合はcandidate
    const highScoreCount = scored.filter((s) => s.total >= candidateTh && s.pScore > 0).length;

    if (best.total >= confidentTh && highScoreCount === 1) {
      results.push({
        statementId: stmt.mfExTransactionId,
        contractId: best.contract.id,
        contractNumber: best.contract.contractNumber,
        billingMonth,
        status: "confident",
        score: best.total,
        reason: `契約マッチ (取引先=${best.sScore}, 期間=${best.pScore}, 金額=${best.aScore})`,
        statement: stmt,
      });
    } else {
      results.push({
        statementId: stmt.mfExTransactionId,
        contractId: best.contract.id,
        contractNumber: best.contract.contractNumber,
        billingMonth,
        status: "candidate",
        score: best.total,
        reason: `候補マッチ (スコア=${best.total}, 候補契約数=${highScoreCount})`,
        statement: stmt,
      });
    }
  }

  // 3. confident結果を契約×月で集約
  const aggMap = new Map<string, ContractAggregate>();
  for (const r of results) {
    if (r.status !== "confident" || !r.contractId) continue;
    const key = `${r.contractId}:${r.billingMonth}`;
    const contract = activeContracts.find((c) => c.id === r.contractId)!;
    const existing = aggMap.get(key);
    if (existing) {
      existing.matchedCount++;
      existing.totalAmount += r.statement.amount;
      existing.overBudget =
        existing.budgetAmount && existing.totalAmount > existing.budgetAmount
          ? existing.totalAmount - existing.budgetAmount
          : null;
    } else {
      const budget = contract.budgetAmount ?? contract.monthlyAmount;
      const total = r.statement.amount;
      aggMap.set(key, {
        contractId: r.contractId,
        contractNumber: r.contractNumber!,
        supplierName: contract.supplierName,
        billingMonth: r.billingMonth,
        matchedCount: 1,
        totalAmount: total,
        budgetAmount: budget,
        overBudget: budget && total > budget ? total - budget : null,
      });
    }
  }

  const aggregates = Array.from(aggMap.values()).sort(
    (a, b) => a.billingMonth.localeCompare(b.billingMonth) || a.contractId - b.contractId,
  );

  return {
    total: results.length,
    confident: results.filter((r) => r.status === "confident").length,
    candidate: results.filter((r) => r.status === "candidate").length,
    unmatched: results.filter((r) => r.status === "unmatched").length,
    aggregates,
    results,
  };
}

/**
 * 契約照合の confident 結果を contract_invoices に反映（upsert）
 * 同一契約×月の既存レコードがあれば金額を更新、なければ作成
 *
 * @returns 作成/更新された請求書レコード数
 */
export async function applyContractMatches(
  summary: ContractMatchSummary,
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  for (const agg of summary.aggregates) {
    // 既存の請求書レコードを検索
    const existing = await db
      .select()
      .from(contractInvoices)
      .where(
        and(
          eq(contractInvoices.contractId, agg.contractId),
          eq(contractInvoices.billingMonth, agg.billingMonth),
        ),
      );

    if (existing.length > 0) {
      const inv = existing[0];
      // 仕訳済みはスキップ（確定後の変更を防ぐ）
      if (inv.status === "仕訳済") continue;

      await db
        .update(contractInvoices)
        .set({
          invoiceAmount: agg.totalAmount,
          amountDiff: inv.expectedAmount != null ? agg.totalAmount - inv.expectedAmount : null,
          updatedAt: new Date(),
        })
        .where(eq(contractInvoices.id, inv.id));
      updated++;
    } else {
      // 契約マスタから期待額を取得
      const contract = await db
        .select()
        .from(contracts)
        .where(eq(contracts.id, agg.contractId));
      const expectedAmount = contract[0]?.monthlyAmount ?? null;

      await db.insert(contractInvoices).values({
        contractId: agg.contractId,
        billingMonth: agg.billingMonth,
        invoiceAmount: agg.totalAmount,
        expectedAmount,
        amountDiff: expectedAmount != null ? agg.totalAmount - expectedAmount : null,
        status: "受領済", // カード明細で確認できているので受領済
      });
      created++;
    }
  }

  return { created, updated };
}
