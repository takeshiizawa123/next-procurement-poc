import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/api-auth";
import { db } from "@/db";
import { contracts, contractInvoices, deadLetterQueue, auditLog, accountCorrections } from "@/db/schema";
import { desc, eq, gte, isNull, sql } from "drizzle-orm";
import { getRecentRequests } from "@/lib/gas-client";

/**
 * 統合ダッシュボードAPI
 * GET /api/admin/dashboard
 *
 * 返却: KPIと警告シグナルを1レスポンスに集約
 */
export async function GET(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // ========== 並列で各種データ取得 ==========
    const last30Days = new Date(Date.now() - 30 * 86400000);

    const [
      dlqCount,
      recentAuditLogs,
      activeContractsList,
      contractInvoicesThisMonth,
      recentRequests,
      learningCount,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)` })
        .from(deadLetterQueue)
        .where(isNull(deadLetterQueue.resolvedAt)),

      db.select().from(auditLog)
        .orderBy(desc(auditLog.createdAt))
        .limit(10),

      db.select().from(contracts).where(eq(contracts.isActive, true)),

      db.select().from(contractInvoices)
        .where(eq(contractInvoices.billingMonth, thisMonth)),

      getRecentRequests(undefined, 100),

      // AI学習: 過去30日の修正件数
      db.select({ count: sql<number>`count(*)` })
        .from(accountCorrections)
        .where(gte(accountCorrections.createdAt, last30Days)),
    ]);

    // ========== 購買申請の統計 ==========
    const requests = recentRequests.success ? (recentRequests.data?.requests || []) : [];
    const thisMonthRequests = requests.filter((r) => {
      const d = new Date(r.applicationDate);
      return !isNaN(d.getTime()) && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    const approvalStats = {
      total: thisMonthRequests.length,
      approved: thisMonthRequests.filter((r) => r.approvalStatus === "承認済").length,
      rejected: thisMonthRequests.filter((r) => r.approvalStatus === "差戻し").length,
      pending: thisMonthRequests.filter((r) => r.approvalStatus === "承認待ち").length,
    };

    const journalStats = {
      posted: thisMonthRequests.filter((r) => r.voucherStatus === "仕訳済" || r.voucherStatus === "計上済").length,
      awaiting: thisMonthRequests.filter((r) => r.voucherStatus === "要取得" && r.inspectionStatus === "検収済").length,
    };

    // 証憑未提出の期間別分類
    const voucherOverdue = {
      lt3: 0, // 3日未満
      d3to7: 0, // 3-7日
      d7to14: 0, // 7-14日
      gt14: 0, // 14日超
    };
    for (const r of requests) {
      if (r.voucherStatus !== "要取得" || r.inspectionStatus !== "検収済") continue;
      const d = new Date(r.applicationDate);
      if (isNaN(d.getTime())) continue;
      const days = Math.floor((Date.now() - d.getTime()) / 86400000);
      if (days < 3) voucherOverdue.lt3++;
      else if (days < 7) voucherOverdue.d3to7++;
      else if (days < 14) voucherOverdue.d7to14++;
      else voucherOverdue.gt14++;
    }

    // ========== 契約の統計 ==========
    const contractsExpiringSoon = activeContractsList.filter((c) => {
      if (!c.contractEndDate) return false;
      const endDate = new Date(c.contractEndDate);
      const daysLeft = Math.ceil((endDate.getTime() - now.getTime()) / 86400000);
      return daysLeft > 0 && daysLeft <= 30;
    }).map((c) => ({
      contractNumber: c.contractNumber,
      supplierName: c.supplierName,
      endDate: c.contractEndDate,
      daysLeft: Math.ceil((new Date(c.contractEndDate!).getTime() - now.getTime()) / 86400000),
    })).sort((a, b) => a.daysLeft - b.daysLeft);

    const contractStats = {
      total: activeContractsList.length,
      expiringSoon: contractsExpiringSoon.length,
      invoicesAwaiting: contractInvoicesThisMonth.filter((i) => i.status === "未受領").length,
      invoicesApproved: contractInvoicesThisMonth.filter((i) => i.status === "承認済").length,
      invoicesJournaled: contractInvoicesThisMonth.filter((i) => i.status === "仕訳済").length,
    };

    return NextResponse.json({
      ok: true,
      date: now.toISOString().split("T")[0],
      thisMonth,
      kpi: {
        approvalStats,
        journalStats,
        voucherOverdue,
        contractStats,
        aiLearning: {
          correctionsLast30Days: Number(learningCount[0]?.count || 0),
        },
      },
      alerts: {
        dlqUnresolved: Number(dlqCount[0]?.count || 0),
        voucherOver14Days: voucherOverdue.gt14,
        contractsExpiringSoon: contractsExpiringSoon.slice(0, 10),
      },
      recentActivity: {
        auditLogs: recentAuditLogs.slice(0, 10).map((a) => ({
          id: a.id,
          tableName: a.tableName,
          recordId: a.recordId,
          action: a.action,
          changedBy: a.changedBy,
          fieldName: a.fieldName,
          newValue: a.newValue,
          createdAt: a.createdAt,
        })),
      },
    });
  } catch (e) {
    console.error("[dashboard] Error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
