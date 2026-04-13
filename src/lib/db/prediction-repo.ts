/**
 * 予測テーブルリポジトリ
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, predictedTransactions } from "@/db/schema";
import { type DbResponse, ok, ng } from "./types";

// ===========================================
// 予測テーブル型
// ===========================================

export interface PredictedTxInput {
  id: string;
  po_number: string;
  type: string; // "purchase" | "trip_transport" | "trip_hotel" | "trip_daily"
  card_last4: string;
  predicted_amount: number;
  predicted_date: string;
  supplier: string;
  applicant: string;
  applicant_slack_id?: string;
  stage1_journal_id?: number;
  status?: string;
  is_estimate?: boolean;
  is_post_report?: boolean;
  emergency_reason?: string;
  // 旧gas-client互換用（DB側では使わない）
  created_at?: string;
  matched_journal_id?: number;
  matched_at?: string;
  amount_diff?: number;
}

export interface PredictedTxOutput {
  id: string;
  po_number: string;
  type: string;
  card_last4: string;
  predicted_amount: number;
  predicted_date: string;
  supplier: string;
  applicant: string;
  applicant_slack_id?: string;
  stage1_journal_id?: number;
  status: string;
  matched_journal_id?: number;
  matched_at?: string;
  amount_diff?: number;
  created_at: string;
  is_estimate?: boolean;
  is_post_report?: boolean;
  emergency_reason?: string;
}

export interface EmployeeCard {
  name: string;
  slackId: string;
  card_last4: string;
  card_holder_name: string;
}

// ===========================================
// 予測テーブル操作
// ===========================================

/**
 * 予測テーブルを取得（月指定）
 */
export async function getPredictedTransactions(
  month: string, // "2026-03"
): Promise<DbResponse<{ predictions: PredictedTxOutput[] }>> {
  try {
    const [year, mo] = month.split("-").map((s) => parseInt(s, 10));
    const start = new Date(year, mo - 1, 1);
    const end = new Date(year, mo, 1);

    const rows = await db
      .select()
      .from(predictedTransactions)
      .where(
        and(
          gte(predictedTransactions.predictedDate, start.toISOString().slice(0, 10)),
          sql`${predictedTransactions.predictedDate} < ${end.toISOString().slice(0, 10)}`,
        ),
      )
      .orderBy(desc(predictedTransactions.predictedDate));

    const predictions: PredictedTxOutput[] = rows.map((r) => ({
      id: r.id,
      po_number: r.poNumber ?? "",
      type: r.type,
      card_last4: r.cardLast4 ?? "",
      predicted_amount: r.predictedAmount,
      predicted_date: r.predictedDate,
      supplier: r.supplier ?? "",
      applicant: r.applicant ?? "",
      applicant_slack_id: r.applicantSlackId ?? undefined,
      status: r.status,
      matched_journal_id: r.matchedJournalId ?? undefined,
      matched_at: r.matchedAt?.toISOString(),
      amount_diff: r.amountDiff ?? undefined,
      is_estimate: r.isEstimate,
      is_post_report: r.isPostReport,
      emergency_reason: r.emergencyReason ?? undefined,
      created_at: r.createdAt.toISOString(),
    }));
    return ok({ predictions });
  } catch (e) {
    return ng(e instanceof Error ? e.message : String(e));
  }
}

/**
 * 予測テーブルに新規レコードを追加
 */
export async function createPrediction(
  prediction: PredictedTxInput,
): Promise<DbResponse<{ id: string }>> {
  try {
    await db.insert(predictedTransactions).values({
      id: prediction.id,
      poNumber: prediction.po_number,
      type: prediction.type as "purchase" | "trip_transport" | "trip_hotel" | "trip_daily" | "reimbursement",
      cardLast4: prediction.card_last4 ?? null,
      predictedAmount: prediction.predicted_amount,
      predictedDate: prediction.predicted_date,
      supplier: prediction.supplier,
      applicant: prediction.applicant,
      applicantSlackId: prediction.applicant_slack_id ?? null,
      status: (prediction.status ?? "pending") as "pending" | "matched" | "unmatched" | "cancelled",
      isEstimate: prediction.is_estimate ?? false,
      isPostReport: prediction.is_post_report ?? false,
      emergencyReason: prediction.emergency_reason ?? null,
    });
    return ok({ id: prediction.id });
  } catch (e) {
    return ng(e instanceof Error ? e.message : String(e));
  }
}

/**
 * 予測テーブルのステータスを更新
 */
export async function updatePredictionStatus(
  predictionId: string,
  updates: {
    status?: "pending" | "matched" | "unmatched" | "cancelled";
    matched_journal_id?: number;
    matched_at?: string;
    amount_diff?: number;
  },
): Promise<DbResponse<{ id: string }>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped: Record<string, any> = {};
    if (updates.status) mapped.status = updates.status;
    if (updates.matched_journal_id !== undefined) mapped.matchedJournalId = updates.matched_journal_id;
    if (updates.matched_at) mapped.matchedAt = new Date(updates.matched_at);
    if (updates.amount_diff !== undefined) mapped.amountDiff = updates.amount_diff;

    await db.update(predictedTransactions).set(mapped).where(eq(predictedTransactions.id, predictionId));
    return ok({ id: predictionId });
  } catch (e) {
    return ng(e instanceof Error ? e.message : String(e));
  }
}

/**
 * 従業員マスタ（カード情報付き）を取得
 */
export async function getEmployeeCards(): Promise<DbResponse<{ employees: EmployeeCard[] }>> {
  try {
    const rows = await db
      .select({
        name: employees.name,
        slackId: employees.slackId,
        cardLast4: employees.cardLast4,
        cardHolderName: employees.cardHolderName,
      })
      .from(employees)
      .where(and(eq(employees.isActive, true), sql`${employees.cardLast4} IS NOT NULL`));
    const list: EmployeeCard[] = rows.map((r) => ({
      name: r.name,
      slackId: r.slackId,
      card_last4: r.cardLast4 ?? "",
      card_holder_name: r.cardHolderName ?? "",
    }));
    return ok({ employees: list });
  } catch (e) {
    return ng(e instanceof Error ? e.message : String(e));
  }
}
