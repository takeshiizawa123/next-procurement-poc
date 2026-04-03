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
  /** 概算フラグ — 金額未確定の場合 true */
  isEstimate?: boolean;
  /** 事後報告フラグ */
  isPostReport?: boolean;
  /** 緊急理由（事後報告時のみ） */
  emergencyReason?: string;
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
    ...(info.isEstimate && { is_estimate: true }),
    ...(info.isPostReport && { is_post_report: true }),
    ...(info.emergencyReason && { emergency_reason: info.emergencyReason }),
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

// --- 出張用予測レコード生成 ---

export interface TripPredictionInfo {
  applicantSlackId: string;
  applicantName: string;
  /** 交通費（カード決済分） */
  transportAmount: number;
  /** 宿泊費（カード決済分。0なら宿泊予測なし） */
  accommodationAmount: number;
  /** 出発日 YYYY-MM-DD */
  startDate: string;
  /** 宿泊チェックイン日 YYYY-MM-DD（未指定なら startDate を使用） */
  checkInDate?: string;
  /** 行き先（加盟店名のヒントとして使用） */
  destination: string;
  /** 概算フラグ */
  isEstimate?: boolean;
}

/**
 * 出張承認時に交通費・宿泊費の予測レコードを別行で生成
 *
 * 日当はカード決済ではないため予測レコード不要。
 *
 * @returns 生成した予測IDの配列
 */
export async function generateTripPredictions(
  info: TripPredictionInfo,
): Promise<string[]> {
  const employees = await getEmployeeCardsCached();
  const emp = employees.find((e) => e.slackId === info.applicantSlackId);

  if (!emp?.card_last4) {
    console.warn(
      `[prediction] No card info for trip ${info.applicantName} (${info.applicantSlackId}). Skipping.`,
    );
    return [];
  }

  const now = new Date();
  const ids: string[] = [];

  // 交通費の予測（出発日）
  if (info.transportAmount > 0) {
    const month = info.startDate.slice(0, 7);
    const seq = String(now.getTime() % 10000).padStart(4, "0");
    const predId = `PCT-${month.replace("-", "")}-${seq}`;

    try {
      const res = await createPrediction({
        id: predId,
        po_number: `TR-TRANSPORT`,
        type: "trip_transport",
        card_last4: emp.card_last4,
        predicted_amount: info.transportAmount,
        predicted_date: info.startDate,
        supplier: info.destination,
        applicant: info.applicantName,
        status: "pending",
        created_at: now.toISOString(),
        ...(info.isEstimate && { is_estimate: true }),
      });
      if (res.success) {
        ids.push(predId);
        console.log(`[prediction] Trip transport: ${predId} ¥${info.transportAmount.toLocaleString()}`);
      }
    } catch (e) {
      console.error("[prediction] Trip transport error:", e);
    }
  }

  // 宿泊費の予測（チェックイン日）
  if (info.accommodationAmount > 0) {
    const checkIn = info.checkInDate || info.startDate;
    const month = checkIn.slice(0, 7);
    const seq2 = String((now.getTime() + 1) % 10000).padStart(4, "0");
    const predId = `PCT-${month.replace("-", "")}-${seq2}`;

    try {
      const res = await createPrediction({
        id: predId,
        po_number: `TR-HOTEL`,
        type: "trip_hotel",
        card_last4: emp.card_last4,
        predicted_amount: info.accommodationAmount,
        predicted_date: checkIn,
        supplier: info.destination,
        applicant: info.applicantName,
        status: "pending",
        created_at: now.toISOString(),
        ...(info.isEstimate && { is_estimate: true }),
      });
      if (res.success) {
        ids.push(predId);
        console.log(`[prediction] Trip hotel: ${predId} ¥${info.accommodationAmount.toLocaleString()}`);
      }
    } catch (e) {
      console.error("[prediction] Trip hotel error:", e);
    }
  }

  return ids;
}
