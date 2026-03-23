import { NextRequest, NextResponse } from "next/server";
import { getSlackClient } from "@/lib/slack";
import { getRecentRequests } from "@/lib/gas-client";

const CRON_SECRET = process.env.CRON_SECRET || "";

/**
 * 週次リマインド（月曜朝 未完了者DM）
 * GET /api/cron/weekly-reminder
 *
 * Vercel Cron: "0 0 * * 1" (UTC 00:00 Mon = JST 09:00 Mon)
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = getSlackClient();
    const result = await getRecentRequests(undefined, 30);
    const requests = result.success ? (result.data?.requests || []) : [];

    // 申請者ごとに未完了案件をグルーピング
    const byApplicant: Record<string, { prNumber: string; itemName: string; status: string }[]> = {};

    for (const r of requests) {
      // 完了済みはスキップ
      const isComplete = r.voucherStatus === "添付済" || r.voucherStatus === "管理本部対応";
      if (isComplete && r.inspectionStatus === "検収済") continue;

      // 進行中の案件
      let status = "";
      if (r.approvalStatus === "承認待ち") status = "承認待ち";
      else if (r.orderStatus === "未発注") status = "発注待ち";
      else if (r.inspectionStatus === "未検収") status = "検収待ち";
      else if (r.voucherStatus === "要取得") status = "証憑待ち";
      else continue;

      // Slack IDを抽出
      const match = (r.applicant || "").match(/<@(U[A-Z0-9]+)>/);
      const slackId = match?.[1] || "";
      if (!slackId) continue;

      if (!byApplicant[slackId]) byApplicant[slackId] = [];
      byApplicant[slackId].push({ prNumber: r.prNumber, itemName: r.itemName, status });
    }

    let sent = 0;
    for (const [slackId, items] of Object.entries(byApplicant)) {
      if (items.length === 0) continue;

      const lines = [
        `📋 *週次リマインド* — あなたの未完了案件: ${items.length}件`,
        "",
        ...items.map((it) => `  • ${it.prNumber}: ${it.itemName}（${it.status}）`),
        "",
        "対応をお願いします。",
      ];

      await client.chat.postMessage({
        channel: slackId,
        text: lines.join("\n"),
      });
      sent++;
    }

    return NextResponse.json({ ok: true, applicants: Object.keys(byApplicant).length, sent });
  } catch (error) {
    console.error("[weekly-reminder] Error:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
