import { NextRequest, NextResponse } from "next/server";
import { getSlackClient } from "@/lib/slack";
import { getRecentRequests } from "@/lib/gas-client";
import { resolveApprovalRoute } from "@/lib/approval-router";

const CRON_SECRET = process.env.CRON_SECRET || "";

/**
 * 証憑催促バッチ
 * GET /api/cron/voucher-reminder
 *
 * Vercel Cron Job から毎朝10:00 JSTに呼び出し:
 * vercel.json: { "crons": [{ "path": "/api/cron/voucher-reminder", "schedule": "0 1 * * *" }] }
 * (UTC 01:00 = JST 10:00)
 *
 * 証憑催促ルール:
 *   Day1: 申請者にDM（ダイジェスト）
 *   Day3: スレッドに公開投稿（@申請者）
 *   Day7: 部門長にDMエスカレーション
 */
export async function GET(request: NextRequest) {
  // Cron認証（Vercel Cron or 手動実行時）
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = getSlackClient();
    const result = await getRecentRequests(undefined, 30);

    if (!result.success || !result.data?.requests) {
      return NextResponse.json({ ok: true, message: "No data", reminded: 0 });
    }

    const pending = result.data.requests.filter(
      (r) => r.voucherStatus === "要取得" && r.inspectionStatus === "検収済"
    );

    let reminded = 0;

    for (const req of pending) {
      // 経過日数を計算
      const appDate = new Date(req.applicationDate);
      if (isNaN(appDate.getTime())) continue;
      const days = Math.floor((Date.now() - appDate.getTime()) / (1000 * 60 * 60 * 24));

      // Slack IDを抽出（<@UXXXX> 形式から）
      const slackIdMatch = (req.applicant || "").match(/<@(U[A-Z0-9]+)>/);
      const applicantSlackId = slackIdMatch?.[1] || "";

      if (days >= 7) {
        // Day7+: 部門長にDMエスカレーション
        const route = await resolveApprovalRoute(req.applicant, applicantSlackId, 0);
        if (route.primaryApprover) {
          await client.chat.postMessage({
            channel: route.primaryApprover,
            text: `🚨 *証憑未提出エスカレーション*\n${req.applicant} の案件が証憑待ちで *${days}日間* 停止しています。\n• ${req.prNumber}: ${req.itemName}\n経理処理・支払が進められない状態です。ご確認をお願いします。`,
          });
          reminded++;
        }
        // スレッドにも公開投稿
        if (req.slackLink) {
          const tsMatch = req.slackLink.match(/\/p(\d+)$/);
          const threadTs = tsMatch ? tsMatch[1].slice(0, 10) + "." + tsMatch[1].slice(10) : "";
          const channelMatch = req.slackLink.match(/archives\/([A-Z0-9]+)\//);
          const ch = channelMatch?.[1] || "";
          if (ch && threadTs) {
            await client.chat.postMessage({
              channel: ch,
              thread_ts: threadTs,
              text: `🚨 *証憑未提出: ${days}日経過* — ${req.applicant} さん、納品書・領収書をこのスレッドに添付してください。経理処理が進められません。`,
            });
          }
        }
      } else if (days >= 3) {
        // Day3: スレッドに公開投稿
        if (req.slackLink) {
          const tsMatch = req.slackLink.match(/\/p(\d+)$/);
          const threadTs = tsMatch ? tsMatch[1].slice(0, 10) + "." + tsMatch[1].slice(10) : "";
          const channelMatch = req.slackLink.match(/archives\/([A-Z0-9]+)\//);
          const ch = channelMatch?.[1] || "";
          if (ch && threadTs) {
            await client.chat.postMessage({
              channel: ch,
              thread_ts: threadTs,
              text: `⏰ 証憑待ち（${days}日経過）— ${req.applicant} さん、納品書をこのスレッドに添付してください。`,
            });
            reminded++;
          }
        }
      } else if (days >= 1 && applicantSlackId) {
        // Day1: 申請者にDM
        await client.chat.postMessage({
          channel: applicantSlackId,
          text: `📎 証憑の添付をお願いします\n• ${req.prNumber}: ${req.itemName}（${days}日経過）\nSlackスレッドに納品書・領収書を添付してください。`,
        });
        reminded++;
      }
    }

    // --- UX-1: 承認リマインダー（24時間超） ---
    let approvalReminded = 0;
    const pendingApproval = result.data.requests.filter(
      (r) => r.approvalStatus === "承認待ち"
    );
    for (const req of pendingApproval) {
      const appDate = new Date(req.applicationDate);
      if (isNaN(appDate.getTime())) continue;
      const days = Math.floor((Date.now() - appDate.getTime()) / 86400000);
      if (days >= 1) {
        const slackIdMatch = (req.applicant || "").match(/<@(U[A-Z0-9]+)>/);
        const applicantSlackId = slackIdMatch?.[1] || "";
        const route = await resolveApprovalRoute(req.applicant, applicantSlackId, 0);
        if (route.primaryApprover) {
          await client.chat.postMessage({
            channel: route.primaryApprover,
            text: `⏳ *承認待ちリマインド*（${days}日経過）\n• ${req.prNumber}: ${req.itemName}（${req.applicant}）\n#purchase-request で承認をお願いします。`,
          });
          approvalReminded++;
        }
      }
    }

    // --- UX-2: 発注完了リマインダー（承認済・未発注 3日超） ---
    let orderReminded = 0;
    const pendingOrder = result.data.requests.filter(
      (r) => r.approvalStatus === "承認済" && r.orderStatus === "未発注"
    );
    for (const req of pendingOrder) {
      const appDate = new Date(req.applicationDate);
      if (isNaN(appDate.getTime())) continue;
      const days = Math.floor((Date.now() - appDate.getTime()) / 86400000);
      if (days >= 3) {
        const slackIdMatch = (req.applicant || "").match(/<@(U[A-Z0-9]+)>/);
        const applicantSlackId = slackIdMatch?.[1] || "";
        if (applicantSlackId) {
          await client.chat.postMessage({
            channel: applicantSlackId,
            text: `🛒 *発注完了の確認*（${days}日経過）\n• ${req.prNumber}: ${req.itemName}\n購入済みであれば #purchase-request で [発注完了] ボタンを押してください。`,
          });
          orderReminded++;
        }
      }
    }

    return NextResponse.json({ ok: true, pending: pending.length, reminded, approvalReminded, orderReminded });
  } catch (error) {
    console.error("[voucher-reminder] Error:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
