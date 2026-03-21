import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import {
  getSlackClient,
  actionHandlers,
  handlePoTestCommand,
  handlePurchaseCommand,
  parsePurchaseFormValues,
  buildNewRequestBlocks,
  type PurchaseFormData,
} from "@/lib/slack";

// Vercel Serverless の最大実行時間
export const maxDuration = 10;

/**
 * Slack Events / Interactive Messages / Slash Commands の統一エンドポイント
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();

    // Content-Type に応じてペイロードをパース
    const contentType = request.headers.get("content-type") || "";
    let payload: Record<string, unknown>;

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(body);
      if (params.has("payload")) {
        payload = JSON.parse(params.get("payload")!);
      } else {
        payload = Object.fromEntries(params.entries());
      }
    } else {
      payload = JSON.parse(body);
    }

    // URL Verification
    if (payload.type === "url_verification") {
      return NextResponse.json({ challenge: payload.challenge });
    }

    // Slash Commands — 同期的に処理してレスポンスを返す
    if (typeof payload.command === "string") {
      const command = payload.command as string;
      const channelId = payload.channel_id as string;
      const userId = payload.user_id as string;

      if (command === "/po-test") {
        try {
          const client = getSlackClient();
          await handlePoTestCommand(client, channelId, userId);
          return new NextResponse("", { status: 200 });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return NextResponse.json({
            response_type: "ephemeral",
            text: `Error: ${msg}`,
          });
        }
      }

      if (command === "/purchase") {
        const triggerId = payload.trigger_id as string;
        if (!triggerId) {
          return NextResponse.json({
            response_type: "ephemeral",
            text: "Error: trigger_id が取得できませんでした",
          });
        }
        try {
          const client = getSlackClient();
          // コマンド実行元のチャンネルIDをモーダルに埋め込む
          const sourceChannelId = channelId;
          await handlePurchaseCommand(client, triggerId, sourceChannelId);
          return new NextResponse("", { status: 200 });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return NextResponse.json({
            response_type: "ephemeral",
            text: `Error: ${msg}`,
          });
        }
      }

      return NextResponse.json({
        response_type: "ephemeral",
        text: `Unknown command: ${command}`,
      });
    }

    // モーダル送信（view_submission）
    if (payload.type === "view_submission") {
      const view = payload.view as {
        callback_id: string;
        private_metadata: string;
        state: { values: Record<string, Record<string, { value?: string; selected_option?: { value: string } }>> };
      };

      if (view.callback_id === "purchase_submit") {
        const userId = (payload.user as { id: string }).id;
        const userName = (payload.user as { name?: string; username?: string }).name
          || (payload.user as { username?: string }).username
          || userId;
        const formData = parsePurchaseFormValues(view.state.values);
        const targetChannelId = view.private_metadata || PURCHASE_CHANNEL;

        // モーダルを即座に閉じる（3秒制限対策）
        // バックグラウンドで後続処理
        after(async () => {
          await handlePurchaseSubmission(userId, userName, formData, targetChannelId);
        });

        return NextResponse.json({ response_action: "clear" });
      }

      return NextResponse.json({ response_action: "clear" });
    }

    // Interactive Messages（ボタン）
    if (payload.type === "block_actions") {
      try {
        await handleBlockActions(payload);
      } catch (error) {
        console.error("[slack] block_actions error:", error);
      }
      return new NextResponse("", { status: 200 });
    }

    return new NextResponse("", { status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[slack] fatal error:", msg);
    return NextResponse.json({ error: msg }, { status: 200 });
  }
}

// --- 購買申請 submit ハンドラー ---

const PURCHASE_CHANNEL = process.env.SLACK_PURCHASE_CHANNEL || "";

async function handlePurchaseSubmission(
  userId: string,
  userName: string,
  formData: PurchaseFormData,
  targetChannelId: string
): Promise<void> {
  try {
    const client = getSlackClient();

    // TODO: GAS連携でPO番号発番・スプレッドシート登録（Sprint 1-3で実装）
    const now = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const seq = String(Math.floor(Math.random() * 9999) + 1).padStart(4, "0");
    const poNumber = `PO-${yyyymm}-${seq}`;

    const amount = `¥${formData.amount.toLocaleString()}`;

    // #purchase-request にメッセージ投稿
    const channelId = targetChannelId || PURCHASE_CHANNEL;
    if (!channelId) {
      console.error("[purchase] SLACK_PURCHASE_CHANNEL is not set");
      // フォールバック: 申請者にDMでエラー通知
      await client.chat.postMessage({
        channel: userId,
        text: `⚠️ 購買申請の投稿先チャンネルが設定されていません。管理者に連絡してください。\n申請内容: ${formData.itemName} ${amount}`,
      });
      return;
    }

    const result = await client.chat.postMessage({
      channel: channelId,
      blocks: buildNewRequestBlocks({
        poNumber,
        itemName: formData.itemName,
        amount,
        applicant: `<@${userId}>`,
        department: "", // TODO: 従業員マスタから取得（Sprint 1-6）
        supplierName: formData.supplierName,
        paymentMethod: formData.paymentMethod,
        applicantSlackId: userId,
      }),
      text: `購買申請: ${poNumber} ${formData.itemName} ${amount}`,
    });

    console.log("[purchase] Posted to channel:", {
      poNumber,
      channelId,
      messageTs: result.ts,
      userId,
    });

    // TODO: GASにステータス登録（Sprint 1-5）
    // TODO: 承認者にDM送信（Sprint 2-2）

  } catch (error) {
    console.error("[purchase] submission error:", error);
    // 申請者にDMでエラー通知
    try {
      const client = getSlackClient();
      await client.chat.postMessage({
        channel: userId,
        text: `⚠️ 購買申請の処理中にエラーが発生しました。再度お試しください。\nエラー: ${error instanceof Error ? error.message : String(error)}`,
      });
    } catch {
      console.error("[purchase] Failed to send error DM");
    }
  }
}

// --- Interactive Messages ハンドラー ---

async function handleBlockActions(
  payload: Record<string, unknown>
): Promise<void> {
  const client = getSlackClient();

  const user = payload.user as {
    id: string;
    name?: string;
    username?: string;
  };
  const actions = payload.actions as Array<{
    action_id: string;
    value: string;
  }>;
  const channel = payload.channel as { id: string };
  const message = payload.message as { ts: string };

  if (!user || !actions || !channel || !message) {
    console.error("Invalid block_actions payload");
    return;
  }

  for (const action of actions) {
    const handler = actionHandlers[action.action_id];
    if (handler) {
      await handler({
        client,
        body: payload,
        userId: user.id,
        userName: user.name || user.username || user.id,
        channelId: channel.id,
        messageTs: message.ts,
        actionValue: action.value,
      });
    } else {
      console.warn(`Unknown action_id: ${action.action_id}`);
    }
  }
}
