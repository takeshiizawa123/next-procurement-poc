import { NextRequest, NextResponse } from "next/server";
import { fetchAllCardStatements } from "@/lib/mf-expense";
import { matchByOfficeMember, matchContractCards } from "@/lib/card-matcher-v2";

const CRON_SECRET = process.env.CRON_SECRET || "";

/**
 * カード照合 v2 のテストエンドポイント
 * GET /api/test/card-match-v2?from=2026-03-01&to=2026-04-10
 *
 * 認証: Bearer CRON_SECRET
 *
 * - MF経費から明細取得
 * - A) office_member_id ベースで予測テーブルとマッチング
 * - B) supplierName ベースで契約マスタ(カード自動)とマッチング
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
    const predictionSummary = await matchByOfficeMember(statements);
    const t2 = Date.now();
    const contractSummary = await matchContractCards(statements);
    const t3 = Date.now();

    return NextResponse.json({
      ok: true,
      period: { from, to },
      officeWide,
      timing: {
        fetchMs: t1 - t0,
        predictionMatchMs: t2 - t1,
        contractMatchMs: t3 - t2,
      },
      sourceCounts: Object.fromEntries(
        Object.entries(
          statements.reduce<Record<string, number>>((acc, s) => {
            acc[s.source] = (acc[s.source] ?? 0) + 1;
            return acc;
          }, {}),
        ),
      ),
      // A) 予測照合
      predictionMatch: {
        total: predictionSummary.total,
        confident: predictionSummary.confident,
        candidate: predictionSummary.candidate,
        unmatched: predictionSummary.unmatched,
        unreported: predictionSummary.unreported,
      },
      predictionSample: predictionSummary.results.slice(0, 5).map((r) => ({
        statementId: r.statementId,
        predictionId: r.predictionId,
        status: r.status,
        score: r.score,
        reason: r.reason,
        memberName: r.statement.memberName,
        amount: r.statement.amount,
        date: r.statement.date,
      })),
      // B) 契約照合
      contractMatch: {
        total: contractSummary.total,
        confident: contractSummary.confident,
        candidate: contractSummary.candidate,
        unmatched: contractSummary.unmatched,
      },
      contractAggregates: contractSummary.aggregates,
      contractSample: contractSummary.results.slice(0, 5).map((r) => ({
        statementId: r.statementId,
        contractId: r.contractId,
        contractNumber: r.contractNumber,
        billingMonth: r.billingMonth,
        status: r.status,
        score: r.score,
        reason: r.reason,
        amount: r.statement.amount,
        remark: r.statement.remark,
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
