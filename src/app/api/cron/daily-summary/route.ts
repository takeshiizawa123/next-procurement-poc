import { NextRequest, NextResponse } from "next/server";
import { getSlackClient } from "@/lib/slack";
import { getRecentRequests } from "@/lib/gas-client";

const CRON_SECRET = process.env.CRON_SECRET || "";
const OPS_CHANNEL = process.env.SLACK_OPS_CHANNEL || "";

/**
 * 日次サマリ投稿（3区分: 要対応 / フォロー要 / 順調）
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
    const result = await getRecentRequests(undefined, 50);
    const requests = result.success ? (result.data?.requests || []) : [];

    // 分類
    interface TrackedItem {
      prNumber: string;
      itemName: string;
      applicant: string;
      days: number;
      slackLink: string;
    }

    const actionRequired: TrackedItem[] = []; // 要対応: 承認待ち・発注待ち
    const followUp: TrackedItem[] = [];       // フォロー要: 証憑遅延（3日+）・検収遅延
    let pendingApproval = 0;
    let pendingOrder = 0;
    let pendingInspection = 0;
    let pendingVoucher = 0;
    let onTrack = 0;
    let completed = 0;

    const now = Date.now();

    for (const r of requests) {
      const d = new Date(r.applicationDate);
      const days = !isNaN(d.getTime()) ? Math.floor((now - d.getTime()) / 86400000) : 0;
      const item: TrackedItem = {
        prNumber: r.prNumber,
        itemName: r.itemName,
        applicant: r.applicant,
        days,
        slackLink: r.slackLink || "",
      };

      if (r.approvalStatus === "承認待ち") {
        pendingApproval++;
        actionRequired.push(item);
      } else if (r.orderStatus === "未発注" && r.approvalStatus === "承認済") {
        pendingOrder++;
        actionRequired.push(item);
      } else if (r.inspectionStatus === "未検収" && r.orderStatus === "発注済") {
        pendingInspection++;
        if (days >= 3) {
          followUp.push(item);
        } else {
          onTrack++;
        }
      } else if (r.voucherStatus === "要取得" && r.inspectionStatus === "検収済") {
        pendingVoucher++;
        if (days >= 3) {
          followUp.push(item);
        } else {
          onTrack++;
        }
      } else {
        completed++;
      }
    }

    // ソート: 経過日数が大きい順
    actionRequired.sort((a, b) => b.days - a.days);
    followUp.sort((a, b) => b.days - a.days);

    // --- メッセージ組み立て ---
    const lines: string[] = [
      `📊 *購買日次サマリ* — ${new Date().toLocaleDateString("ja-JP")}`,
    ];

    // 要対応セクション
    const actionCount = pendingApproval + pendingOrder;
    if (actionCount > 0) {
      lines.push("", `🔴 *要対応（${actionCount}件）*`);
      if (pendingApproval > 0) lines.push(`  承認待ち: *${pendingApproval}件*`);
      if (pendingOrder > 0) lines.push(`  発注待ち: *${pendingOrder}件*`);
      for (const item of actionRequired.slice(0, 5)) {
        const link = item.slackLink ? ` <${item.slackLink}|開く>` : "";
        lines.push(`  • ${item.prNumber}: ${item.itemName}（${item.applicant}, ${item.days}日経過）${link}`);
      }
      if (actionRequired.length > 5) {
        lines.push(`  …他 ${actionRequired.length - 5}件`);
      }
    }

    // フォロー要セクション
    const followCount = followUp.length;
    if (followCount > 0) {
      lines.push("", `🟡 *フォロー要（${followCount}件）* — 3日以上停滞`);
      if (pendingVoucher > 0) lines.push(`  証憑待ち: *${pendingVoucher}件*`);
      if (pendingInspection > 0) lines.push(`  検収待ち: *${pendingInspection}件*`);
      for (const item of followUp.slice(0, 5)) {
        const severity = item.days >= 7 ? "🚨" : "⚠️";
        const link = item.slackLink ? ` <${item.slackLink}|開く>` : "";
        lines.push(`  ${severity} ${item.prNumber}: ${item.itemName}（${item.applicant}, *${item.days}日*経過）${link}`);
      }
      if (followUp.length > 5) {
        lines.push(`  …他 ${followUp.length - 5}件`);
      }
    }

    // 順調セクション
    lines.push("", `🟢 *順調* — 進行中: ${onTrack + pendingInspection + pendingVoucher - followCount}件 / 完了: ${completed}件`);

    // 要対応ゼロの場合
    if (actionCount === 0 && followCount === 0) {
      lines.push("", "✅ 要対応・フォロー案件はありません");
    }

    await client.chat.postMessage({
      channel: OPS_CHANNEL,
      text: lines.join("\n"),
    });

    return NextResponse.json({
      ok: true,
      summary: { pendingApproval, pendingOrder, pendingInspection, pendingVoucher, onTrack, completed, followUp: followCount },
    });
  } catch (error) {
    console.error("[daily-summary] Error:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
