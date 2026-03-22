import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import {
  getSlackClient,
  actionHandlers,
  handlePoTestCommand,
  handlePurchaseCommand,
  parsePurchaseFormValues,
  buildNewRequestBlocks,
  buildPurchasedRequestBlocks,
  sendApprovalDM,
  notifyOps,
  type PurchaseFormData,
  type RequestInfo,
} from "@/lib/slack";
import { registerPurchase, getEmployees } from "@/lib/gas-client";

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
          const result = await handlePurchaseCommand(client, triggerId, channelId, userId);
          // chooser の場合はエフェメラルを投稿済みなので空レスポンス
          // modal の場合も views.open 済みなので空レスポンス
          return new NextResponse(result === "chooser" ? "" : "", { status: 200 });
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

// 暫定承認者（従業員マスタ実装まで環境変数で指定）
const DEFAULT_APPROVER = process.env.SLACK_DEFAULT_APPROVER || "";

async function handlePurchaseSubmission(
  userId: string,
  userName: string,
  formData: PurchaseFormData,
  targetChannelId: string
): Promise<void> {
  try {
    const client = getSlackClient();

    const now = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const seq = String(Math.floor(Math.random() * 9999) + 1).padStart(4, "0");
    const poNumber = `PO-${yyyymm}-${seq}`;

    const amount = `¥${formData.amount.toLocaleString()}`;

    const approverSlackId = DEFAULT_APPROVER;

    // 従業員マスタから部門名を取得
    let department = "";
    try {
      const empResult = await getEmployees();
      if (empResult.success && empResult.data?.employees) {
        const match = empResult.data.employees.find((emp) => {
          const aliases = emp.slackAliases
            .split(/[,、]/)
            .map((a) => a.trim().toLowerCase());
          const uname = userName.toLowerCase();
          return (
            emp.name === userName ||
            emp.name.includes(userName) ||
            userName.includes(emp.name) ||
            aliases.some((a) => a && (a === uname || uname.includes(a)))
          );
        });
        if (match) department = match.departmentName;
      }
    } catch {
      console.warn("[purchase] Could not fetch employee master");
    }

    // #purchase-request にメッセージ投稿
    const channelId = targetChannelId || PURCHASE_CHANNEL;
    if (!channelId) {
      console.error("[purchase] SLACK_PURCHASE_CHANNEL is not set");
      await client.chat.postMessage({
        channel: userId,
        text: `⚠️ 購買申請の投稿先チャンネルが設定されていません。管理者に連絡してください。\n申請内容: ${formData.itemName} ${amount}`,
      });
      return;
    }

    const isPurchased = formData.requestType === "購入済";

    const requestInfo: RequestInfo = {
      poNumber,
      itemName: formData.itemName,
      amount,
      applicant: `<@${userId}>`,
      department,
      supplierName: formData.supplierName,
      paymentMethod: formData.paymentMethod,
      applicantSlackId: userId,
      approverSlackId: isPurchased ? "" : approverSlackId,
      inspectorSlackId: formData.inspectorSlackId || userId,
    };

    // 購入済 → 承認・発注スキップ、即「検収済・証憑待ち」
    // 購入前 → 通常の承認フロー
    const blocks = isPurchased
      ? buildPurchasedRequestBlocks(requestInfo)
      : buildNewRequestBlocks(requestInfo);

    const result = await client.chat.postMessage({
      channel: channelId,
      blocks,
      text: `購買申請: ${poNumber} ${formData.itemName} ${amount}`,
    });

    console.log("[purchase] Posted to channel:", {
      poNumber,
      channelId,
      messageTs: result.ts,
      userId,
      isPurchased,
    });

    if (isPurchased) {
      // 購入済: スレッドに証憑催促を投稿
      if (result.ts) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: result.ts,
          text: [
            `📦 購入済申請を受け付けました（${userName}）`,
            `📎 納品書・領収書をこのスレッドに添付してください。`,
            `⏸️ 証憑が添付されるまで、経理処理は保留されます。`,
          ].join("\n"),
        });
      }
      // ops通知
      await notifyOps(client, `📦 *購入済申請* ${poNumber} — ${formData.itemName} ${amount}（<@${userId}>）— 証憑待ち`);
    } else {
      // 購入前: 承認者にDM送信
      if (approverSlackId && result.ts) {
        try {
          await sendApprovalDM(client, requestInfo, channelId, result.ts);
          console.log("[purchase] Sent approval DM to:", approverSlackId);
        } catch (dmError) {
          console.error("[purchase] Failed to send approval DM:", dmError);
        }
      }
      // ops通知
      await notifyOps(client, `🔵 *新規申請* ${poNumber} — ${formData.itemName} ${amount}（<@${userId}>）— 承認待ち`);
    }

    // GAS（スプレッドシート）に購買申請を登録
    const slackLink = result.ts
      ? `https://slack.com/archives/${channelId}/p${result.ts.replace(".", "")}`
      : "";

    try {
      const gasResult = await registerPurchase({
        applicant: userName,
        itemName: formData.itemName,
        totalAmount: formData.amount,
        purchaseSource: formData.supplierName,
        paymentMethod: formData.paymentMethod,
        poNumber,
        slackTs: result.ts || "",
        slackLink,
        isPurchased,
      });
      if (gasResult.success) {
        console.log("[purchase] GAS registered:", gasResult.data);
      } else {
        console.error("[purchase] GAS register failed:", gasResult.error);
      }
    } catch (gasError) {
      console.error("[purchase] GAS register error:", gasError);
    }

  } catch (error) {
    console.error("[purchase] submission error:", error);
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
