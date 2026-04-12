import { NextRequest, NextResponse } from "next/server";
import { fetchAllCardStatements } from "@/lib/mf-expense";
import { matchByOfficeMember } from "@/lib/card-matcher-v2";

const CRON_SECRET = process.env.CRON_SECRET || "";

/**
 * カード照合 v2 のテストエンドポイント
 * GET /api/test/card-match-v2?from=2026-03-01&to=2026-04-10
 *
 * 認証: Bearer CRON_SECRET
 *
 * - MF経費から明細取得
 * - office_member_id ベースで予測テーブルとマッチング
 * - 結果をJSON返却（実際のDB更新は行わない dry-run）
 */
export async function GET(request: NextRequest) {
  if (CRON_SECRET) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const from = request.nextUrl.searchParams.get("from") || "2026-03-01";
  const to = request.nextUrl.searchParams.get("to") || "2026-04-10";
  const officeWide = request.nextUrl.searchParams.get("officeWide") !== "false";

  try {
    const t0 = Date.now();
    const statements = await fetchAllCardStatements({ from, to, officeWide });
    const t1 = Date.now();
    const summary = await matchByOfficeMember(statements);
    const t2 = Date.now();

    return NextResponse.json({
      ok: true,
      period: { from, to },
      officeWide,
      timing: { fetchMs: t1 - t0, matchMs: t2 - t1 },
      sourceCounts: Object.fromEntries(
        Object.entries(
          statements.reduce<Record<string, number>>((acc, s) => {
            acc[s.source] = (acc[s.source] ?? 0) + 1;
            return acc;
          }, {}),
        ),
      ),
      summary: {
        total: summary.total,
        confident: summary.confident,
        candidate: summary.candidate,
        unmatched: summary.unmatched,
        unreported: summary.unreported,
      },
      // サンプル結果5件のみ（機密情報を含むため）
      sampleResults: summary.results.slice(0, 5).map((r) => ({
        statementId: r.statementId,
        predictionId: r.predictionId,
        status: r.status,
        score: r.score,
        reason: r.reason,
        memberName: r.statement.memberName,
        amount: r.statement.amount,
        date: r.statement.date,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
