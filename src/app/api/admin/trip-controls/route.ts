import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-auth";
import {
  detectAmountVariances,
  detectDuplicateRoutes,
  getDepartmentTripCosts,
  getPersonalTripRanking,
} from "@/lib/trip-controls";

/**
 * 出張統制ダッシュボード API
 * GET /api/admin/trip-controls?month=2026-04
 *
 * 認証: Bearer CRON_SECRET
 */
export async function GET(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const month = request.nextUrl.searchParams.get("month") ||
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

  try {
    const [variances, duplicates, departmentCosts, ranking] = await Promise.all([
      detectAmountVariances(month),
      detectDuplicateRoutes(30),
      getDepartmentTripCosts(month),
      getPersonalTripRanking(month, 10),
    ]);

    return NextResponse.json({
      ok: true,
      month,
      variances,
      duplicates,
      departmentCosts,
      ranking,
      summary: {
        varianceCount: variances.length,
        highSeverityCount: variances.filter((v) => v.severity === "HIGH").length,
        duplicateRouteCount: duplicates.length,
        totalTripCost: departmentCosts.reduce((s, d) => s + d.totalAmount, 0),
        totalTripCount: departmentCosts.reduce((s, d) => s + d.tripCount, 0),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
