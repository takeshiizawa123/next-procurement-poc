/**
 * カード明細突合・異常検知エンジン
 *
 * 参考: procureflow_agent_archive.md §1, §7
 *       expense_gas_archive.md §3
 */

import type { PastRequest } from "./gas-client";

// --- 定数 ---

const TOLERANCE_ABSOLUTE = 500;   // ±500円
const TOLERANCE_PERCENT = 0.05;   // ±5%
const TAX_RATE_10 = 0.10;
const TAX_RATE_8 = 0.08;
const TAX_TOLERANCE = 5;          // 税計算時の許容差額（円）
const SCORE_THRESHOLD = 50;       // マッチスコア閾値

// --- 型定義 ---

export interface CardStatement {
  date: string;           // YYYY-MM-DD
  description: string;    // 利用明細
  amount: number;         // 金額
  cardName?: string;      // カード名
}

export interface ReconciliationResult {
  /** 未申請購入（明細あり＋申請なし） */
  noRequest: CardStatement[];
  /** 承認前購入（明細日付 < 承認日） */
  preApproval: { statement: CardStatement; request: PastRequest }[];
  /** 金額不一致 */
  amountMismatch: { statement: CardStatement; request: PastRequest; difference: number }[];
  /** 正常マッチ */
  matched: { statement: CardStatement; request: PastRequest; score: number }[];
  /** 処理日時 */
  processedAt: string;
}

// --- ベンダー名正規化 ---

function normalizeVendor(name: string): string {
  return name
    .replace(/株式会社|有限会社|合同会社/g, "")
    .replace(/[（(][株有][）)]/g, "")
    .replace(/[\s　]+/g, " ")
    .trim()
    .toLowerCase();
}

// --- マッチスコア計算 ---

function calculateMatchScore(
  statement: CardStatement,
  request: PastRequest,
): number {
  let score = 0;

  // 金額マッチ (60点満点)
  const reqAmount = request.totalAmount;
  const diff = Math.abs(statement.amount - reqAmount);
  const ratio = reqAmount > 0 ? diff / reqAmount : 1;

  if (diff === 0) {
    score += 60;
  } else if (diff <= TOLERANCE_ABSOLUTE || ratio <= TOLERANCE_PERCENT) {
    score += 50;
  } else if (ratio <= 0.3) {
    score += Math.floor(30 * (1 - ratio));
  }
  // 税込マッチ（税抜金額 × 税率が一致する場合）
  if (score < 50) {
    const tax10 = Math.round(reqAmount * (1 + TAX_RATE_10));
    const tax8 = Math.round(reqAmount * (1 + TAX_RATE_8));
    if (Math.abs(statement.amount - tax10) <= TAX_TOLERANCE) score = 55;
    else if (Math.abs(statement.amount - tax8) <= TAX_TOLERANCE) score = 55;
  }

  // ベンダー名マッチ (30点満点)
  const stVendor = normalizeVendor(statement.description);
  const reqVendor = normalizeVendor(request.supplierName);
  if (stVendor === reqVendor) {
    score += 30;
  } else if (stVendor.includes(reqVendor) || reqVendor.includes(stVendor)) {
    score += 25;
  } else {
    // 単語単位のマッチ
    const stWords = stVendor.split(/\s+/);
    const reqWords = reqVendor.split(/\s+/);
    const matched = stWords.filter((w) => reqWords.some((rw) => rw.includes(w) || w.includes(rw)));
    if (matched.length > 0 && reqWords.length > 0) {
      score += Math.floor(20 * (matched.length / reqWords.length));
    }
  }

  // 日付近接 (10点満点: 30日以内)
  const stDate = new Date(statement.date);
  const reqDate = new Date(request.applicationDate);
  if (!isNaN(stDate.getTime()) && !isNaN(reqDate.getTime())) {
    const daysDiff = Math.abs(stDate.getTime() - reqDate.getTime()) / 86400000;
    if (daysDiff <= 30) {
      score += Math.floor(10 * (1 - daysDiff / 30));
    }
  }

  return score;
}

// --- 突合メイン処理 ---

/**
 * カード明細と購買台帳を突合
 */
export function reconcile(
  statements: CardStatement[],
  requests: PastRequest[],
): ReconciliationResult {
  const result: ReconciliationResult = {
    noRequest: [],
    preApproval: [],
    amountMismatch: [],
    matched: [],
    processedAt: new Date().toISOString(),
  };

  const usedRequests = new Set<string>();

  for (const st of statements) {
    // 全申請とスコアリング
    const candidates = requests
      .filter((r) => !usedRequests.has(r.prNumber))
      .map((r) => ({ request: r, score: calculateMatchScore(st, r) }))
      .filter((c) => c.score >= SCORE_THRESHOLD)
      .sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      // 未申請購入
      result.noRequest.push(st);
      continue;
    }

    const best = candidates[0];
    usedRequests.add(best.request.prNumber);

    // 承認前購入チェック
    const stDate = new Date(st.date);
    const approvalDate = new Date(best.request.applicationDate);
    if (!isNaN(stDate.getTime()) && !isNaN(approvalDate.getTime()) && stDate < approvalDate) {
      result.preApproval.push({ statement: st, request: best.request });
    }

    // 金額不一致チェック
    const diff = st.amount - best.request.totalAmount;
    const absDiff = Math.abs(diff);
    const pctDiff = best.request.totalAmount > 0 ? absDiff / best.request.totalAmount : 1;
    if (absDiff > TOLERANCE_ABSOLUTE && pctDiff > TOLERANCE_PERCENT) {
      result.amountMismatch.push({ statement: st, request: best.request, difference: diff });
    } else {
      result.matched.push({ statement: st, request: best.request, score: best.score });
    }
  }

  return result;
}

// --- 異常検知ヘルパー ---

export interface AnomalyAlert {
  type: "no_request" | "pre_approval" | "amount_mismatch" | "amount_anomaly" | "duplicate";
  severity: "LOW" | "MEDIUM" | "HIGH";
  message: string;
  details: string;
}

/**
 * 突合結果からアラートを生成
 */
export function generateAlerts(result: ReconciliationResult): AnomalyAlert[] {
  const alerts: AnomalyAlert[] = [];

  for (const st of result.noRequest) {
    alerts.push({
      type: "no_request",
      severity: "HIGH",
      message: `未申請購入検知: ${st.description} ¥${st.amount.toLocaleString()} (${st.date})`,
      details: `カード明細に購入記録がありますが、対応する購買申請がありません。`,
    });
  }

  for (const item of result.preApproval) {
    alerts.push({
      type: "pre_approval",
      severity: "MEDIUM",
      message: `承認前購入: ${item.request.prNumber} — 明細日 ${item.statement.date} < 申請日 ${item.request.applicationDate}`,
      details: `カード利用日が購買申請日より前です。事前承認なしの購入の可能性。`,
    });
  }

  for (const item of result.amountMismatch) {
    const sign = item.difference > 0 ? "+" : "";
    alerts.push({
      type: "amount_mismatch",
      severity: Math.abs(item.difference) >= 10000 ? "HIGH" : "MEDIUM",
      message: `金額不一致: ${item.request.prNumber} — 申請¥${item.request.totalAmount.toLocaleString()} / 明細¥${item.statement.amount.toLocaleString()} (${sign}${item.difference.toLocaleString()})`,
      details: `申請金額とカード明細金額が一致しません。`,
    });
  }

  return alerts;
}
