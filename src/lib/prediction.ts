/**
 * 予測明細生成
 *
 * 購買申請の承認時に、カード決済の予測明細を生成して
 * GAS予測テーブルに書き込む。
 *
 * 照合エンジン（card-matcher.ts）が月次でこの予測と
 * 実際のカード明細をマッチングする。
 */

import {
  getEmployeeCards,
  createPrediction,
  type EmployeeCard,
} from "./gas-client";

interface ApprovalInfo {
  poNumber: string;
  applicantSlackId: string;
  applicantName: string;
  amount: number;
  supplierName: string;
  paymentMethod: string;
  /** 予定利用日（未指定なら承認日を使用） */
  expectedDate?: string;
}

// 従業員カード情報のキャッシュ（プロセス単位、5分TTL）
let employeeCardCache: { data: EmployeeCard[]; fetchedAt: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

async function getEmployeeCardsCached(): Promise<EmployeeCard[]> {
  if (employeeCardCache && Date.now() - employeeCardCache.fetchedAt < CACHE_TTL) {
    return employeeCardCache.data;
  }
  const res = await getEmployeeCards();
  const data = res.success ? (res.data?.employees || []) : [];
  employeeCardCache = { data, fetchedAt: Date.now() };
  return data;
}

/**
 * カード払いかどうか判定
 */
export function isCardPayment(paymentMethod: string): boolean {
  return paymentMethod.includes("カード") || paymentMethod.includes("card");
}

/**
 * 承認時に予測明細を生成してGASに書き込む
 *
 * カード払いの場合のみ実行。立替・請求書払いはスキップ。
 * 従業員のSlackIDからカード下4桁を解決する。
 *
 * @returns 生成した予測ID。カード払い以外やカード情報なしの場合はnull
 */
export async function generatePrediction(
  info: ApprovalInfo,
): Promise<string | null> {
  if (!isCardPayment(info.paymentMethod)) {
    return null;
  }

  // 従業員のカード情報を解決
  const employees = await getEmployeeCardsCached();
  const emp = employees.find((e) => e.slackId === info.applicantSlackId);

  if (!emp?.card_last4) {
    console.warn(
      `[prediction] No card info for ${info.applicantName} (${info.applicantSlackId}). Skipping prediction.`,
    );
    return null;
  }

  const now = new Date();
  const predictedDate = info.expectedDate || now.toISOString().split("T")[0];
  const month = predictedDate.slice(0, 7); // "2026-03"

  // 予測IDを生成: PCT-YYYYMM-NNNN（衝突回避のためタイムスタンプベース）
  const seq = String(now.getTime() % 10000).padStart(4, "0");
  const predictionId = `PCT-${month.replace("-", "")}-${seq}`;

  const prediction = {
    id: predictionId,
    po_number: info.poNumber,
    type: info.poNumber.startsWith("TR-") ? "trip_transport" : "purchase",
    card_last4: emp.card_last4,
    predicted_amount: info.amount,
    predicted_date: predictedDate,
    supplier: info.supplierName,
    applicant: info.applicantName,
    status: "pending",
    created_at: now.toISOString(),
  };

  try {
    const res = await createPrediction(prediction);
    if (res.success) {
      console.log(
        `[prediction] Created: ${predictionId} — ${info.poNumber} ` +
        `¥${info.amount.toLocaleString()} *${emp.card_last4} ${info.supplierName}`,
      );
      return predictionId;
    } else {
      console.error(`[prediction] GAS error: ${res.error}`);
      return null;
    }
  } catch (e) {
    console.error("[prediction] Failed to create:", e);
    return null;
  }
}
