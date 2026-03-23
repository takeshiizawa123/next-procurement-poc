import { NextRequest, NextResponse } from "next/server";
import { getSlackClient } from "@/lib/slack";
import { getRecentRequests } from "@/lib/gas-client";

const CRON_SECRET = process.env.CRON_SECRET || "";
const OPS_CHANNEL = process.env.SLACK_OPS_CHANNEL || "";

/**
 * 日次サマリ投稿
 * GET /api/cron/daily-summary
 *
 * Vercel Cron: "0 0 * * *" (UTC 00:00 = JST 09:00)
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!OPS_CHANNEL) {
    return NextResponse.json({ ok: false, error: "SLACK_OPS_CHANNEL not set" });
  }

  try {
    const client = getSlackClient();
    const result = await getRecentRequests(undefined, 30);
    const requests = result.success ? (result.data?.requests || []) : [];

    // 集計
    let pendingApproval = 0;
    let pendingOrder = 0;
    let pendingInspection = 0;
    let pendingVoucher = 0;
    let completed = 0;
    const voucherOverdue: { prNumber: string; itemName: string; applicant: string; days: number }[] = [];

    for (const r of requests) {
      if (r.approvalStatus === "承認待ち") pendingApproval++;
      else if (r.orderStatus === "未発注" && r.approvalStatus === "承認済") pendingOrder++;
      else if (r.inspectionStatus === "未検収" && r.orderStatus === "発注済") pendingInspection++;
      else if (r.voucherStatus === "要取得" && r.inspectionStatus === "検収済") {
        pendingVoucher++;
        const d = new Date(r.applicationDate);
        if (!isNaN(d.getTime())) {
          const days = Math.floor((Date.now() - d.getTime()) / 86400000);
          if (days >= 3) {
            voucherOverdue.push({ prNumber: r.prNumber, itemName: r.itemName, applicant: r.applicant, days });
          }
        }
      } else {
        completed++;
      }
    }

    const lines = [
      `📊 *購買日次サマリ* — ${new Date().toLocaleDateString("ja-JP")}`,
      "",
      `• 承認待ち: *${pendingApproval}件*`,
      `• 発注待ち: *${pendingOrder}件*`,
      `• 検収待ち: *${pendingInspection}件*`,
      `• 証憑待ち: *${pendingVoucher}件*`,
      `• 完了: ${completed}件`,
    ];

    if (voucherOverdue.length > 0) {
      lines.push("", "⚠️ *証憑超過（3日以上）:*");
      for (const v of voucherOverdue.slice(0, 5)) {
        lines.push(`  • ${v.prNumber}: ${v.itemName}（${v.applicant}, ${v.days}日経過）`);
      }
      if (voucherOverdue.length > 5) {
        lines.push(`  …他 ${voucherOverdue.length - 5}件`);
      }
    }

    if (pendingApproval + pendingOrder + pendingVoucher === 0) {
      lines.push("", "✅ 要対応案件はありません");
    }

    await client.chat.postMessage({
      channel: OPS_CHANNEL,
      text: lines.join("\n"),
    });

    return NextResponse.json({ ok: true, summary: { pendingApproval, pendingOrder, pendingInspection, pendingVoucher, completed } });
  } catch (error) {
    console.error("[daily-summary] Error:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
