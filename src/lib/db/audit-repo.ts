/**
 * 監査ログ・下書き保存・冪等性チェックリポジトリ
 */

import { and, desc, eq, like, or } from "drizzle-orm";
import { db } from "@/db";
import {
  purchaseDrafts,
  accountCorrections,
  auditLog,
  slackEventLog,
  type AuditLogEntry,
} from "@/db/schema";
import { type DbResponse, ok, ng } from "./types";

// ===========================================
// 勘定科目修正履歴型
// ===========================================

export interface CorrectionRecord {
  itemName: string;
  supplierName: string | null;
  estimatedAccount: string;
  correctedAccount: string;
  correctedTaxType: string | null;
}

// ===========================================
// 下書き保存
// ===========================================

export async function savePurchaseDraft(
  userId: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(purchaseDrafts).values({
      userId,
      draft: data,
    });
  } catch (e) {
    console.warn("[db-client] savePurchaseDraft failed:", e);
  }
}

export async function loadPurchaseDraft(
  userId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const rows = await db
      .select()
      .from(purchaseDrafts)
      .where(eq(purchaseDrafts.userId, userId))
      .orderBy(desc(purchaseDrafts.savedAt))
      .limit(1);
    return rows[0]?.draft as Record<string, unknown> | null ?? null;
  } catch (e) {
    console.warn("[db-client] loadPurchaseDraft failed:", e);
    return null;
  }
}

export async function clearPurchaseDraft(userId: string): Promise<void> {
  try {
    await db.delete(purchaseDrafts).where(eq(purchaseDrafts.userId, userId));
  } catch (e) {
    console.warn("[db-client] clearPurchaseDraft failed:", e);
  }
}

// ===========================================
// 勘定科目修正履歴
// ===========================================

/**
 * 取引先・品目名に関連する過去の修正履歴を取得（RAGコンテキスト用）
 */
export async function getAccountCorrections(
  supplier: string,
  keyword: string,
): Promise<CorrectionRecord[]> {
  try {
    const conditions = [];
    if (supplier) conditions.push(like(accountCorrections.supplierName, `%${supplier}%`));
    if (keyword) conditions.push(like(accountCorrections.itemName, `%${keyword}%`));
    if (conditions.length === 0) return [];

    const rows = await db
      .select({
        itemName: accountCorrections.itemName,
        supplierName: accountCorrections.supplierName,
        estimatedAccount: accountCorrections.estimatedAccount,
        correctedAccount: accountCorrections.correctedAccount,
        correctedTaxType: accountCorrections.correctedTaxType,
      })
      .from(accountCorrections)
      .where(or(...conditions))
      .orderBy(desc(accountCorrections.createdAt))
      .limit(20);

    return rows;
  } catch (e) {
    console.warn("[db-client] getAccountCorrections failed:", e);
    return [];
  }
}

// ===========================================
// 監査ログ
// ===========================================

/**
 * 監査ログを記録
 */
export async function writeAuditLog(entries: {
  tableName: string;
  recordId: string;
  action: string;
  changedBy?: string;
  fieldName?: string;
  oldValue?: string;
  newValue?: string;
  metadata?: Record<string, unknown>;
}[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    await db.insert(auditLog).values(
      entries.map((e) => ({
        tableName: e.tableName,
        recordId: e.recordId,
        action: e.action,
        changedBy: e.changedBy || null,
        fieldName: e.fieldName || null,
        oldValue: e.oldValue || null,
        newValue: e.newValue || null,
        metadata: e.metadata || null,
      })),
    );
  } catch (e) {
    console.warn("[db-client] writeAuditLog failed:", e);
  }
}

/**
 * 監査ログを取得（特定レコードの変更履歴）
 */
export async function getAuditLog(
  tableName: string,
  recordId: string,
): Promise<AuditLogEntry[]> {
  try {
    return await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tableName, tableName), eq(auditLog.recordId, recordId)))
      .orderBy(desc(auditLog.createdAt))
      .limit(100);
  } catch (e) {
    console.warn("[db-client] getAuditLog failed:", e);
    return [];
  }
}

// ===========================================
// Slackイベント冪等性チェック
// ===========================================

/**
 * Slackイベントが処理済みかチェックし、未処理なら記録して false を返す。
 * 既に処理済みなら true を返す（呼び出し元はスキップすべき）。
 */
export async function checkSlackEventProcessed(
  eventId: string,
  eventType?: string,
): Promise<boolean> {
  try {
    const existing = await db
      .select({ eventId: slackEventLog.eventId })
      .from(slackEventLog)
      .where(eq(slackEventLog.eventId, eventId))
      .limit(1);
    if (existing.length > 0) return true; // 処理済み
    // 未処理 → 記録
    await db.insert(slackEventLog).values({
      eventId,
      eventType: eventType ?? null,
    }).onConflictDoNothing();
    return false;
  } catch (e) {
    console.warn("[db-client] checkSlackEventProcessed failed:", e);
    return false; // エラー時は処理を続行（安全側に倒す）
  }
}
