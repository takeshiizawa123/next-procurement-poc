import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-auth";
import { getSlackClient, notifyOps } from "@/lib/slack";

interface MatchSummary {
  totalOrders: number;
  totalRequests: number;
  matchedCount: number;
  candidateCount: number;
  unmatchedOrderCount: number;
  unmatchedRequestCount: number;
  matchRate: string;
}

interface DiffAlert {
  prNumber: string;
  itemName: string;
  requestAmount: number;
  amazonAmount: number;
  diff: number;
}

/**
 * Amazon照合結果サマリをSlack #管理本部に投稿
 * POST /api/admin/amazon-matching/summary
 */
export async function POST(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  try {
    const body = (await request.json()) as {
      summary: MatchSummary;
      diffAlerts: DiffAlert[];
      dateRange?: string;
    };

    const { summary, diffAlerts, dateRange } = body;
    if (!summary) {
      return NextResponse.json({ error: "summary is required" }, { status: 400 });
    }

    const client = getSlackClient();
    const today = new Date().toLocaleDateString("ja-JP");

    const lines = [
      `📦 *Amazon照合レポート* — ${today}`,
      dateRange ? `対象期間: ${dateRange}` : "",
      "",
      `✅ 一致: ${summary.matchedCount}件`,
      `🟡 要確認: ${summary.candidateCount}件`,
      `🔴 未一致注文: ${summary.unmatchedOrderCount}件`,
      `⬜ 未一致申請: ${summary.unmatchedRequestCount}件`,
      `照合率: ${summary.matchRate}`,
    ].filter(Boolean);

    // 差額アラート（±5,000円超）
    if (diffAlerts.length > 0) {
      lines.push("", `⚠️ *差額アラート（±¥5,000超）: ${diffAlerts.length}件*`);
      for (const a of diffAlerts.slice(0, 10)) {
        const sign = a.diff > 0 ? "+" : "";
        lines.push(
          `  • ${a.prNumber} ${a.itemName.substring(0, 20)} — 申請¥${a.requestAmount.toLocaleString()} / Amazon¥${a.amazonAmount.toLocaleString()} (${sign}¥${a.diff.toLocaleString()})`,
        );
      }
      if (diffAlerts.length > 10) {
        lines.push(`  …他 ${diffAlerts.length - 10}件`);
      }
    }

    await notifyOps(client, lines.join("\n"));

    return NextResponse.json({ ok: true, posted: true });
  } catch (error) {
    console.error("[amazon-summary] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
