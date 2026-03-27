/**
 * カード明細マッチングエンジン
 *
 * mf-card-reconciler の matcher.py を TypeScript に移植。
 * 2フェーズ照合:
 *   Phase 1: 予測マッチング（card_last4 × 金額 × 日付）
 *   Phase 2: スコアリング（金額 + 日付 + 加盟店名）
 */

import type { PredictedTransaction, EmployeeCard } from "./gas-client";
import type { JournalListItem } from "./mf-accounting";

// --- 入力型 ---

/** フロントからPOSTされるカード明細（CSVパース済み） */
export interface CardStatementInput {
  id: string;
  date: string; // YYYY-MM-DD
  merchant: string;
  amount: number;
  cardHolder: string;
  cardLast4: string;
  status: string; // 確定 / 速報
}

// --- 出力型 ---

export type MatchConfidence = "high" | "medium" | "low";

export interface ConfidentMatch {
  statementId: string;
  poNumber: string;
  applicant: string;
  supplier: string;
  predictedAmount: number;
  actualAmount: number;
  diff: number;
  cardLast4: string;
  date: string;
  matchMethod: "prediction" | "score";
  score: number;
  confidence: MatchConfidence;
}

export interface CandidateInfo {
  date: string;
  amount: number;
  merchant: string;
  cardLast4: string;
  method: string;
  score: number;
}

export interface CandidateMatch {
  poNumber: string;
  applicant: string;
  supplier: string;
  amount: number;
  date: string;
  cardLast4: string;
  candidates: CandidateInfo[];
}

export interface UnmatchedPurchase {
  poNumber: string;
  applicant: string;
  supplier: string;
  amount: number;
  cardLast4: string;
  applicationDate: string;
  predictionId: string;
  reason: string;
}

export interface UnreportedUsage {
  statementId: string;
  date: string;
  amount: number;
  merchant: string;
  cardLast4: string;
  employee: string;
  reason: string;
}

export interface MatchingResult {
  month: string;
  executedAt: string;
  confidentMatches: ConfidentMatch[];
  candidateMatches: CandidateMatch[];
  unmatchedPurchases: UnmatchedPurchase[];
  unreportedUsage: UnreportedUsage[];
  summary: {
    totalStatements: number;
    totalPredictions: number;
    confidentCount: number;
    candidateCount: number;
    unmatchedCount: number;
    unreportedCount: number;
    matchRate: number;
  };
}

// --- 設定 ---

interface MatchingSettings {
  /** 予測マッチの日付許容日数 */
  predictionDateTolerance: number;
  /** 予測マッチの金額差許容率 (0.05 = 5%) */
  predictionAmountTolerance: number;
  /** スコアマッチの自動確定閾値 */
  scoreAutoThreshold: number;
  /** スコアマッチの候補表示閾値 */
  scoreCandidateThreshold: number;
  /** スコアマッチの日付許容日数 */
  scoreDateTolerance: number;
}

const DEFAULT_SETTINGS: MatchingSettings = {
  predictionDateTolerance: 7,
  predictionAmountTolerance: 0.05,
  scoreAutoThreshold: 80,
  scoreCandidateThreshold: 50,
  scoreDateTolerance: 5,
};

// --- ヘルパー ---

function daysDiff(a: string, b: string): number {
  const da = new Date(a);
  const db = new Date(b);
  return Math.abs(Math.round((da.getTime() - db.getTime()) / (1000 * 60 * 60 * 24)));
}

/** テキスト正規化: 大文字化+記号除去 */
function normalizeText(s: string): string {
  return s
    .toUpperCase()
    .replace(/[\s.\-_,()（）「」【】]/g, "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
    );
}

/** 簡易ファジーマッチ: 共通部分文字列の割合 */
function fuzzyScore(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 90;

  // 先頭N文字一致
  const prefixLen = Math.min(na.length, nb.length, 6);
  if (na.slice(0, prefixLen) === nb.slice(0, prefixLen)) return 70;

  // bigram overlap
  const bigramsA = new Set<string>();
  for (let i = 0; i < na.length - 1; i++) bigramsA.add(na.slice(i, i + 2));
  let overlap = 0;
  let totalB = 0;
  for (let i = 0; i < nb.length - 1; i++) {
    totalB++;
    if (bigramsA.has(nb.slice(i, i + 2))) overlap++;
  }
  if (totalB === 0) return 0;
  return Math.round((overlap / Math.max(bigramsA.size, totalB)) * 100);
}

/** MF仕訳の摘要からカード下4桁を抽出 */
function extractCardLast4FromRemark(remark: string): string | null {
  // パターン: "*3815 " or "＊3815 " or "カード番号:3815"
  const m = remark.match(/[*＊](\d{4})\s/) || remark.match(/カード番号[:：]?\s*(\d{4})/);
  return m ? m[1] : null;
}

/** card_last4 → 従業員名を解決 */
function resolveEmployee(
  cardLast4: string,
  employeeCards: EmployeeCard[],
): string {
  const emp = employeeCards.find((e) => e.card_last4 === cardLast4);
  return emp?.name || `カード *${cardLast4}`;
}

// --- Phase 1: 予測マッチング ---

function phase1PredictionMatch(
  statements: CardStatementInput[],
  predictions: PredictedTransaction[],
  settings: MatchingSettings,
): {
  confident: ConfidentMatch[];
  candidates: CandidateMatch[];
  usedStatementIds: Set<string>;
  usedPredictionIds: Set<string>;
} {
  const confident: ConfidentMatch[] = [];
  const candidateMap = new Map<string, CandidateInfo[]>();
  const usedStatementIds = new Set<string>();
  const usedPredictionIds = new Set<string>();

  const pendingPredictions = predictions.filter((p) => p.status === "pending");

  for (const stmt of statements) {
    // card_last4 が一致する予測を検索
    const matching = pendingPredictions.filter(
      (p) =>
        p.card_last4 === stmt.cardLast4 &&
        !usedPredictionIds.has(p.id),
    );

    const scored: { pred: PredictedTransaction; score: number; amountDiff: number }[] = [];

    for (const pred of matching) {
      const dateDiff = daysDiff(stmt.date, pred.predicted_date);
      if (dateDiff > settings.predictionDateTolerance) continue;

      const amountDiff = Math.abs(stmt.amount - pred.predicted_amount);
      const amountRatio = pred.predicted_amount > 0
        ? amountDiff / pred.predicted_amount
        : (amountDiff === 0 ? 0 : 1);

      if (amountRatio > settings.predictionAmountTolerance * 2) continue; // 10%超は除外

      let score = 0;
      // 金額完全一致: 100, 5%以内: 90, 10%以内: 70
      if (amountDiff === 0) score = 100;
      else if (amountRatio <= 0.05) score = 90;
      else score = 70;

      // 日付が近いほどボーナス
      if (dateDiff <= 3) score = Math.min(100, score);
      else if (dateDiff <= 7) score = Math.max(score - 5, 0);

      scored.push({ pred, score, amountDiff });
    }

    if (scored.length === 0) continue;

    // スコア降順ソート
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];

    if (best.score >= settings.scoreAutoThreshold && scored.length === 1) {
      // 自動確定
      confident.push({
        statementId: stmt.id,
        poNumber: best.pred.po_number,
        applicant: best.pred.applicant,
        supplier: best.pred.supplier,
        predictedAmount: best.pred.predicted_amount,
        actualAmount: stmt.amount,
        diff: stmt.amount - best.pred.predicted_amount,
        cardLast4: stmt.cardLast4,
        date: stmt.date,
        matchMethod: "prediction",
        score: best.score,
        confidence: best.score === 100 ? "high" : "medium",
      });
      usedStatementIds.add(stmt.id);
      usedPredictionIds.add(best.pred.id);
    } else if (scored.length >= 1 && best.score >= settings.scoreCandidateThreshold) {
      // 複数候補 or スコアが中程度 → 要確認
      const key = scored.length === 1 ? best.pred.po_number : stmt.id;
      const candidates: CandidateInfo[] = scored.map((s) => ({
        date: stmt.date,
        amount: stmt.amount,
        merchant: stmt.merchant,
        cardLast4: stmt.cardLast4,
        method: "予測マッチ",
        score: s.score,
      }));
      candidateMap.set(key, candidates);

      // CandidateMatch として格納（最初の予測を代表に）
      if (!candidateMap.has(best.pred.po_number)) {
        candidateMap.set(best.pred.po_number, candidates);
      }
    }
  }

  // candidateMap → CandidateMatch[] に変換
  const candidateMatches: CandidateMatch[] = [];
  const processedPOs = new Set<string>();

  for (const stmt of statements) {
    if (usedStatementIds.has(stmt.id)) continue;

    const matching = pendingPredictions.filter(
      (p) =>
        p.card_last4 === stmt.cardLast4 &&
        !usedPredictionIds.has(p.id),
    );

    for (const pred of matching) {
      if (processedPOs.has(pred.po_number)) continue;

      const dateDiff = daysDiff(stmt.date, pred.predicted_date);
      if (dateDiff > settings.predictionDateTolerance) continue;

      const amountDiff = Math.abs(stmt.amount - pred.predicted_amount);
      const amountRatio = pred.predicted_amount > 0
        ? amountDiff / pred.predicted_amount
        : (amountDiff === 0 ? 0 : 1);
      if (amountRatio > settings.predictionAmountTolerance * 2) continue;

      let score = 0;
      if (amountDiff === 0) score = 100;
      else if (amountRatio <= 0.05) score = 90;
      else score = 70;

      if (score >= settings.scoreCandidateThreshold && score < settings.scoreAutoThreshold) {
        processedPOs.add(pred.po_number);
        candidateMatches.push({
          poNumber: pred.po_number,
          applicant: pred.applicant,
          supplier: pred.supplier,
          amount: pred.predicted_amount,
          date: pred.predicted_date,
          cardLast4: pred.card_last4,
          candidates: [{
            date: stmt.date,
            amount: stmt.amount,
            merchant: stmt.merchant,
            cardLast4: stmt.cardLast4,
            method: "予測マッチ",
            score,
          }],
        });
      }
    }
  }

  return { confident, candidates: candidateMatches, usedStatementIds, usedPredictionIds };
}

// --- Phase 2: スコアリング（フォールバック） ---

function phase2ScoreMatch(
  remainingStatements: CardStatementInput[],
  journals: JournalListItem[],
  employeeCards: EmployeeCard[],
  settings: MatchingSettings,
): {
  confident: ConfidentMatch[];
  candidates: CandidateMatch[];
  usedStatementIds: Set<string>;
  usedJournalIds: Set<number>;
} {
  const confident: ConfidentMatch[] = [];
  const candidates: CandidateMatch[] = [];
  const usedStatementIds = new Set<string>();
  const usedJournalIds = new Set<number>();

  for (const stmt of remainingStatements) {
    const scored: {
      journal: JournalListItem;
      score: number;
      remark: string;
      amount: number;
    }[] = [];

    for (const j of journals) {
      if (usedJournalIds.has(j.id)) continue;

      const branch = j.branches[0];
      if (!branch) continue;

      const journalAmount = branch.debitor.value;
      const remark = branch.remark || j.memo || "";

      // カード番号フィルタ（摘要にカード番号がある場合）
      const journalCard = extractCardLast4FromRemark(remark);
      if (journalCard && journalCard !== stmt.cardLast4) continue;

      // 金額スコア (max 50)
      const amountDiffRatio = journalAmount > 0
        ? Math.abs(stmt.amount - journalAmount) / journalAmount
        : 1;
      let amountScore = 0;
      if (amountDiffRatio === 0) amountScore = 50;
      else if (amountDiffRatio <= 0.01) amountScore = 40;
      else if (amountDiffRatio <= 0.05) amountScore = 25;
      else if (amountDiffRatio <= 0.10) amountScore = 10;
      // > 10% → 0

      if (amountScore === 0) continue; // 10%超は候補にもしない

      // 日付スコア (max 30)
      const dd = daysDiff(stmt.date, j.transaction_date);
      let dateScore = 0;
      if (dd === 0) dateScore = 30;
      else if (dd <= 1) dateScore = 25;
      else if (dd <= 3) dateScore = 15;
      else if (dd <= settings.scoreDateTolerance) dateScore = 5;
      // > tolerance → 0

      // 加盟店名スコア (max 20)
      const merchantScore = Math.round(fuzzyScore(stmt.merchant, remark) * 0.2);

      const total = amountScore + dateScore + merchantScore;
      if (total >= settings.scoreCandidateThreshold) {
        scored.push({ journal: j, score: total, remark, amount: journalAmount });
      }
    }

    if (scored.length === 0) continue;

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    if (best.score >= settings.scoreAutoThreshold && scored.length === 1) {
      // 自動確定
      const employee = resolveEmployee(stmt.cardLast4, employeeCards);
      confident.push({
        statementId: stmt.id,
        poNumber: `J-${best.journal.id}`,
        applicant: employee,
        supplier: stmt.merchant,
        predictedAmount: best.amount,
        actualAmount: stmt.amount,
        diff: stmt.amount - best.amount,
        cardLast4: stmt.cardLast4,
        date: stmt.date,
        matchMethod: "score",
        score: best.score,
        confidence: best.score >= 90 ? "high" : "medium",
      });
      usedStatementIds.add(stmt.id);
      usedJournalIds.add(best.journal.id);
    } else {
      // 候補表示
      const employee = resolveEmployee(stmt.cardLast4, employeeCards);
      candidates.push({
        poNumber: `J-${best.journal.id}`,
        applicant: employee,
        supplier: stmt.merchant,
        amount: stmt.amount,
        date: stmt.date,
        cardLast4: stmt.cardLast4,
        candidates: scored.slice(0, 3).map((s) => ({
          date: s.journal.transaction_date,
          amount: s.amount,
          merchant: s.remark.slice(0, 40),
          cardLast4: stmt.cardLast4,
          method: "スコアリング",
          score: s.score,
        })),
      });
      // 候補なので usedStatementIds には入れない（手動確認待ち）
    }
  }

  return { confident, candidates, usedStatementIds, usedJournalIds };
}

// --- メインエントリ ---

export function executeMatching(params: {
  statements: CardStatementInput[];
  predictions: PredictedTransaction[];
  journals: JournalListItem[];
  employeeCards: EmployeeCard[];
  month: string;
  settings?: Partial<MatchingSettings>;
}): MatchingResult {
  const settings = { ...DEFAULT_SETTINGS, ...params.settings };
  const { statements, predictions, journals, employeeCards, month } = params;

  // Phase 1: 予測マッチング
  const p1 = phase1PredictionMatch(statements, predictions, settings);

  // Phase 2: スコアリング（Phase 1 で未マッチの明細のみ）
  const remainingStatements = statements.filter(
    (s) => !p1.usedStatementIds.has(s.id),
  );
  const p2 = phase2ScoreMatch(remainingStatements, journals, employeeCards, settings);

  // 全確定マッチ
  const confidentMatches = [...p1.confident, ...p2.confident];

  // 全候補マッチ
  const candidateMatches = [...p1.candidates, ...p2.candidates];

  // 未マッチ購買（予測があるのに明細が見つからない）
  const allUsedPredictionIds = p1.usedPredictionIds;
  const unmatchedPurchases: UnmatchedPurchase[] = predictions
    .filter((p) => p.status === "pending" && !allUsedPredictionIds.has(p.id))
    .map((p) => ({
      poNumber: p.po_number,
      applicant: p.applicant,
      supplier: p.supplier,
      amount: p.predicted_amount,
      cardLast4: p.card_last4,
      applicationDate: p.created_at.split("T")[0],
      predictionId: p.id,
      reason: analyzeUnmatchedPrediction(p, statements),
    }));

  // 未申請利用（明細があるのにマッチ先がない）
  const allUsedStatementIds = new Set([
    ...p1.usedStatementIds,
    ...p2.usedStatementIds,
  ]);
  // 候補マッチに含まれる明細IDも除外
  const candidateStatementMerchants = new Set(
    candidateMatches.flatMap((c) => c.candidates.map((cd) => `${cd.date}_${cd.amount}_${cd.cardLast4}`)),
  );

  const unreportedUsage: UnreportedUsage[] = statements
    .filter((s) => {
      if (allUsedStatementIds.has(s.id)) return false;
      // 候補マッチに含まれているものも除外
      const key = `${s.date}_${s.amount}_${s.cardLast4}`;
      if (candidateStatementMerchants.has(key)) return false;
      return true;
    })
    .map((s) => ({
      statementId: s.id,
      date: s.date,
      amount: s.amount,
      merchant: s.merchant,
      cardLast4: s.cardLast4,
      employee: resolveEmployee(s.cardLast4, employeeCards),
      reason: analyzeUnreportedUsage(s, predictions, journals),
    }));

  const matchedCount = confidentMatches.length;
  const matchRate = statements.length > 0
    ? Math.round((matchedCount / statements.length) * 100)
    : 0;

  return {
    month,
    executedAt: new Date().toISOString(),
    confidentMatches,
    candidateMatches,
    unmatchedPurchases,
    unreportedUsage,
    summary: {
      totalStatements: statements.length,
      totalPredictions: predictions.length,
      confidentCount: confidentMatches.length,
      candidateCount: candidateMatches.length,
      unmatchedCount: unmatchedPurchases.length,
      unreportedCount: unreportedUsage.length,
      matchRate,
    },
  };
}

// --- 未マッチ理由分析 ---

function analyzeUnmatchedPrediction(
  pred: PredictedTransaction,
  statements: CardStatementInput[],
): string {
  const sameCard = statements.filter((s) => s.cardLast4 === pred.card_last4);
  if (sameCard.length === 0) {
    return "同一カードの利用明細なし（未利用 or CSVに未掲載）";
  }

  const sameAmount = sameCard.filter((s) => s.amount === pred.predicted_amount);
  if (sameAmount.length === 0) {
    return "金額一致の明細なし（未利用の可能性）";
  }

  return "金額一致の明細あり（既に他の申請で消込済み）";
}

function analyzeUnreportedUsage(
  stmt: CardStatementInput,
  predictions: PredictedTransaction[],
  journals: JournalListItem[],
): string {
  const samePred = predictions.filter(
    (p) => p.card_last4 === stmt.cardLast4 && p.status === "pending",
  );
  if (samePred.length === 0) {
    const hasJournal = journals.some((j) => {
      const branch = j.branches[0];
      return branch && branch.debitor.value === stmt.amount;
    });
    if (hasJournal) return "仕訳あり（申請なしの可能性）";
    return "申請・仕訳とも見つからず（未申請利用）";
  }

  return "予測あるが金額・日付不一致（確認必要）";
}
