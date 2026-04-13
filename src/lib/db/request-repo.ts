/**
 * 過去申請・検索リポジトリ（recentRequests, checkDuplicate, suppliers, pendingVouchers, testConnection）
 */

import { and, desc, eq, gte, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { purchaseRequests } from "@/db/schema";
import { cachedFetch } from "../shared-cache";
import {
  type DbResponse,
  type PastRequest,
  type DuplicateResult,
  type PendingVoucher,
  ok,
  ng,
  DB_SHORT_TTL,
  toPastRequest,
} from "./types";

// invalidateRecentRequests は types.ts からre-exportされるため、ここでは不要

/**
 * 過去申請一覧を取得
 */
export async function getRecentRequests(
  applicant?: string,
  limit?: number,
): Promise<DbResponse<{ requests: PastRequest[] }>> {
  const cacheKey = `db:recentRequests:${applicant || "all"}:${limit || 30}`;
  return cachedFetch(cacheKey, DB_SHORT_TTL, async () => {
    try {
      const where = applicant ? eq(purchaseRequests.applicantName, applicant) : undefined;
      const rows = await db
        .select()
        .from(purchaseRequests)
        .where(where)
        .orderBy(desc(purchaseRequests.applicationDate))
        .limit(limit ?? 30);
      return ok({ requests: rows.map(toPastRequest) });
    } catch (e) {
      return ng<{ requests: PastRequest[] }>(e instanceof Error ? e.message : String(e));
    }
  });
}

/**
 * 重複チェック
 */
export async function checkDuplicate(
  itemName: string,
  totalAmount?: number,
): Promise<DbResponse<{ duplicates: DuplicateResult[] }>> {
  try {
    // 直近30日の類似申請を検索
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const where = and(
      like(purchaseRequests.itemName, `%${itemName}%`),
      gte(purchaseRequests.applicationDate, thirtyDaysAgo),
      totalAmount ? eq(purchaseRequests.totalAmount, totalAmount) : undefined,
    );
    const rows = await db.select().from(purchaseRequests).where(where).limit(10);
    const duplicates: DuplicateResult[] = rows.map((r) => ({
      prNumber: r.poNumber,
      itemName: r.itemName,
      totalAmount: r.totalAmount,
      applicationDate: r.applicationDate?.toISOString() ?? "",
      applicant: r.applicantName,
      status: r.status,
    }));
    return ok({ duplicates });
  } catch (e) {
    return ng(e instanceof Error ? e.message : String(e));
  }
}

/**
 * 購入先名一覧を取得
 */
export async function getSuppliers(): Promise<DbResponse<{ suppliers: string[] }>> {
  return cachedFetch("db:suppliers", DB_SHORT_TTL, async () => {
    try {
      const rows = await db
        .selectDistinct({ supplier: purchaseRequests.supplierName })
        .from(purchaseRequests)
        .where(sql`${purchaseRequests.supplierName} IS NOT NULL`);
      return ok({ suppliers: rows.map((r) => r.supplier).filter((s): s is string => !!s) });
    } catch (e) {
      return ng<{ suppliers: string[] }>(e instanceof Error ? e.message : String(e));
    }
  });
}

/**
 * 証憑未提出一覧を取得
 */
export async function getPendingVouchers(
  applicant: string,
): Promise<DbResponse<{ pending: PendingVoucher[] }>> {
  try {
    const rows = await db
      .select()
      .from(purchaseRequests)
      .where(
        and(
          eq(purchaseRequests.applicantName, applicant),
          eq(purchaseRequests.voucherStatus, "none"),
        ),
      )
      .orderBy(desc(purchaseRequests.applicationDate));
    const pending: PendingVoucher[] = rows.map((r) => {
      const days = r.applicationDate
        ? Math.floor((Date.now() - r.applicationDate.getTime()) / (24 * 60 * 60 * 1000))
        : 0;
      return {
        prNumber: r.poNumber,
        itemName: r.itemName,
        totalAmount: r.totalAmount,
        applicationDate: r.applicationDate?.toISOString() ?? "",
        daysElapsed: days,
      };
    });
    return ok({ pending });
  } catch (e) {
    return ng(e instanceof Error ? e.message : String(e));
  }
}

/**
 * DB接続テスト
 */
export async function testConnection(): Promise<DbResponse<{ status: string; version: string }>> {
  try {
    const result = await db.execute(sql`SELECT version() as version`);
    const version = (result[0] as { version: string })?.version ?? "unknown";
    return ok({ status: "ok", version });
  } catch (e) {
    return ng(e instanceof Error ? e.message : String(e));
  }
}
