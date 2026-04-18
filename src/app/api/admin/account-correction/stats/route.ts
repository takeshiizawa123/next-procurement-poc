import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/api-auth";
import { db } from "@/db";
import { accountCorrections } from "@/db/schema";
import { desc, gte, sql } from "drizzle-orm";

/**
 * 仕訳学習ループの統計
 * GET /api/admin/account-correction/stats?days=30
 *
 * AI推定科目 vs 修正後科目の上位パターンを返す。
 * ダッシュボードで「学習効果が出ている科目」を可視化する用途。
 */
export async function GET(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const daysParam = request.nextUrl.searchParams.get("days");
    const days = Math.min(Math.max(parseInt(daysParam || "30", 10), 1), 365);
    const since = new Date(Date.now() - days * 86400000);

    // 期間内の修正件数
    const [totalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(accountCorrections)
      .where(gte(accountCorrections.createdAt, since));
    const total = Number(totalResult?.count || 0);

    // 修正パターン集計: (estimated → corrected) の上位10件
    const patterns = await db
      .select({
        estimatedAccount: accountCorrections.estimatedAccount,
        correctedAccount: accountCorrections.correctedAccount,
        count: sql<number>`count(*)`,
      })
      .from(accountCorrections)
      .where(gte(accountCorrections.createdAt, since))
      .groupBy(accountCorrections.estimatedAccount, accountCorrections.correctedAccount)
      .orderBy(desc(sql<number>`count(*)`))
      .limit(10);

    // 取引先別の修正件数 top5
    const suppliers = await db
      .select({
        supplierName: accountCorrections.supplierName,
        count: sql<number>`count(*)`,
      })
      .from(accountCorrections)
      .where(gte(accountCorrections.createdAt, since))
      .groupBy(accountCorrections.supplierName)
      .orderBy(desc(sql<number>`count(*)`))
      .limit(5);

    return NextResponse.json({
      ok: true,
      periodDays: days,
      total,
      patterns: patterns.map((p) => ({
        estimated: p.estimatedAccount,
        corrected: p.correctedAccount,
        count: Number(p.count),
      })),
      suppliers: suppliers
        .filter((s) => s.supplierName)
        .map((s) => ({ supplierName: s.supplierName, count: Number(s.count) })),
    });
  } catch (e) {
    console.error("[account-correction/stats] Error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
