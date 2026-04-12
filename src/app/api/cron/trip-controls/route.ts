import { NextRequest, NextResponse } from "next/server";
import { getSlackClient, notifyOps } from "@/lib/slack";
import { fetchAllCardStatements } from "@/lib/mf-expense";
import {
  detectAmountVariances,
  detectUnreportedUsage,
  detectDuplicateRoutes,
  getDepartmentTripCosts,
  getPersonalTripRanking,
  formatReportForSlack,
  type TripControlReport,
} from "@/lib/trip-controls";

const CRON_SECRET = process.env.CRON_SECRET || "";

/**
 * 出張統制レポート（月次 cron）
 * GET /api/cron/trip-controls
 *
 * 月初に前月分のレポートを生成してOPSチャンネルに投稿
 * Vercel Cron: "0 1 1 * *" (毎月1日 10:00 JST)
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 対象月（前月）
    const now = new Date();
    const targetMonth = `${now.getFullYear()}-${String(now.getMonth()).padStart(2, "0")}`;
    // 当月が1月の場合は前年12月
    const [year, mo] = now.getMonth() === 0
      ? [now.getFullYear() - 1, 12]
      : [now.getFullYear(), now.getMonth()];
    const month = `${year}-${String(mo).padStart(2, "0")}`;
    const from = `${year}-${String(mo).padStart(2, "0")}-01`;
    const lastDay = new Date(year, mo, 0).getDate();
    const to = `${year}-${String(mo).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    // 1. カード明細取得（MF経費）
    let unreported: Awaited<ReturnType<typeof detectUnreportedUsage>> = [];
    try {
      const statements = await fetchAllCardStatements({ from, to, officeWide: true });
      unreported = await detectUnreportedUsage(statements);
    } catch (e) {
      console.warn("[trip-controls] fetchCardStatements failed:", e);
    }

    // 2. 各種検出
    const [variances, duplicates, departmentCosts, ranking] = await Promise.all([
      detectAmountVariances(month),
      detectDuplicateRoutes(30),
      getDepartmentTripCosts(month),
      getPersonalTripRanking(month, 10),
    ]);

    const report: TripControlReport = {
      month,
      variances,
      unreported,
      duplicates,
      departmentCosts,
      ranking,
    };

    // 3. Slack投稿
    const slackText = formatReportForSlack(report);
    const hasIssues = variances.length > 0 || unreported.length > 0 || duplicates.length > 0;

    try {
      const client = getSlackClient();
      await notifyOps(client, slackText);
    } catch (e) {
      console.error("[trip-controls] Slack post failed:", e);
    }

    return NextResponse.json({
      ok: true,
      month,
      hasIssues,
      counts: {
        variances: variances.length,
        unreported: unreported.length,
        duplicates: duplicates.length,
        departments: departmentCosts.length,
        rankedPersons: ranking.length,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
