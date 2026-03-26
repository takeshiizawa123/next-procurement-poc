import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
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
import { registerPurchase, updateStatus } from "@/lib/gas-client";
import { estimateAccount } from "@/lib/account-estimator";
import { resolveApprovalRoute } from "@/lib/approval-router";

// Vercel Serverless の最大実行時間
export const maxDuration = 10;

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || "";

/** Slack リクエスト署名を検証（HMAC-SHA256） */
function verifySlackSignature(
  body: string,
  timestamp: string,
  signature: string,
): boolean {
  if (!SIGNING_SECRET) return false;
  // リプレイ攻撃防止: 5分以上古いリクエストを拒否
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 300) return false;

  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature = "v0=" + createHmac("sha256", SIGNING_SECRET).update(sigBasestring).digest("hex");

  try {
    return timingSafeEqual(Buffer.from(mySignature), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Slack Events / Interactive Messages / Slash Commands の統一エンドポイント
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();

    // Slack署名検証（url_verification 以外）
    const slackTimestamp = request.headers.get("x-slack-request-timestamp") || "";
    const slackSignature = request.headers.get("x-slack-signature") || "";

    // url_verification はパース後に判定するため、署名検証を先にペイロード確認
    // ただし署名が存在する場合は必ず検証する
    if (SIGNING_SECRET && slackSignature) {
      if (!verifySlackSignature(body, slackTimestamp, slackSignature)) {
        console.warn("[slack] signature verification failed");
        return NextResponse.json({ error: "invalid signature" }, { status: 401 });
      }
    }

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

    // Events API（file_shared等）
    if (payload.type === "event_callback") {
      const event = payload.event as { type: string; file_id?: string; channel_id?: string; thread_ts?: string; files?: Array<{ id: string }>; ts?: string; subtype?: string };
      if (event.type === "message" && event.subtype === "file_share" && event.thread_ts) {
        after(async () => {
          try {
            await handleFileSharedInThread(event.channel_id || "", event.thread_ts || "", event.ts || "");
          } catch (e) {
            console.error("[slack] file_share handler error:", e);
          }
        });
      }
      return new NextResponse("", { status: 200 });
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

    const amount = `¥${formData.amount.toLocaleString()}`;

    // 承認ルート解決（従業員マスタから部門長を取得）
    const approvalRoute = await resolveApprovalRoute(userName, userId, formData.amount);
    const department = approvalRoute.employee?.departmentName || "";
    const approverSlackId = approvalRoute.primaryApprover || DEFAULT_APPROVER;

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

    // GAS登録を先に行い、GAS発番のPO番号を取得
    const estimation = estimateAccount(formData.itemName, formData.supplierName, formData.amount);
    let poNumber = "";
    try {
      const gasResult = await registerPurchase({
        applicant: userName,
        itemName: formData.itemName,
        totalAmount: formData.amount,
        purchaseSource: formData.supplierName,
        paymentMethod: formData.paymentMethod,
        accountTitle: estimation.account + (estimation.subAccount ? `（${estimation.subAccount}）` : ""),
        isPurchased,
      });
      if (gasResult.success && gasResult.data?.prNumber) {
        poNumber = gasResult.data.prNumber;
        console.log("[purchase] GAS registered:", gasResult.data);
      } else {
        console.error("[purchase] GAS register failed:", gasResult.error);
      }
    } catch (gasError) {
      console.error("[purchase] GAS register error:", gasError);
    }

    // GAS発番失敗時のフォールバック（ローカル発番）
    if (!poNumber) {
      const now = new Date();
      const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
      const seq = String(Math.floor(Math.random() * 9999) + 1).padStart(4, "0");
      poNumber = `PO-${yyyymm}-${seq}`;
      console.warn("[purchase] Falling back to local PO number:", poNumber);
    }

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

    const mentionText = !isPurchased && approverSlackId
      ? ` — 承認者: <@${approverSlackId}>`
      : "";
    const result = await client.chat.postMessage({
      channel: channelId,
      blocks,
      text: `購買申請: ${poNumber} ${formData.itemName} ${amount}${mentionText}`,
    });

    // Slack投稿後にGASのSlackリンク情報を更新
    if (result.ts) {
      const slackLink = `https://slack.com/archives/${channelId}/p${result.ts.replace(".", "")}`;
      try {
        await updateStatus(poNumber, { slackTs: result.ts, slackLink });
      } catch (e) {
        console.error("[purchase] Failed to update GAS with Slack link:", e);
      }
    }

    // 承認者メンションをスレッドに投稿
    if (!isPurchased && approverSlackId && result.ts) {
      const approverMention = `<@${approverSlackId}>`;
      const secondMention = approvalRoute.requiresSecondApproval && approvalRoute.secondaryApprover
        ? ` → <@${approvalRoute.secondaryApprover}>`
        : "";
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: result.ts,
        text: `📋 承認依頼: ${approverMention}${secondMention}\n${approvalRoute.requiresSecondApproval ? "（10万円以上: 二段階承認）" : ""}`,
      });
    }

    console.log("[purchase] Posted to channel:", {
      poNumber,
      channelId,
      messageTs: result.ts,
      userId,
      isPurchased,
      approver: approverSlackId,
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

// --- 証憑添付自動検知 ---

/** 証憑として受け付けるMIMEタイプ */
const VOUCHER_MIME_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "画像(JPEG)",
  "image/png": "画像(PNG)",
  "image/heic": "画像(HEIC)",
  "image/webp": "画像(WebP)",
  "image/tiff": "画像(TIFF)",
};

/** ファイル名から証憑種別を推定 */
function classifyVoucher(fileName: string): string {
  const n = fileName.toLowerCase();
  if (/receipt|領収/.test(n)) return "領収書";
  if (/invoice|請求/.test(n)) return "請求書";
  if (/delivery|納品/.test(n)) return "納品書";
  if (/quotation|見積/.test(n)) return "見積書";
  return "その他証憑";
}

/**
 * スレッド内のファイル添付を検知し、購買申請の証憑として処理
 */
async function handleFileSharedInThread(channelId: string, threadTs: string, eventTs: string) {
  const client = getSlackClient();

  // 添付されたメッセージを取得（ファイル情報含む）
  let fileNames: string[] = [];
  let fileMimeTypes: string[] = [];
  try {
    const replies = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      latest: eventTs,
      inclusive: true,
      limit: 1,
    });
    const msg = replies.messages?.find((m) => m.ts === eventTs);
    const files = (msg?.files || []) as Array<{ name?: string; mimetype?: string }>;
    fileNames = files.map((f) => f.name || "");
    fileMimeTypes = files.map((f) => f.mimetype || "");
  } catch {
    // ファイル情報取得失敗でもPO番号検知は続行
  }

  // 証憑として有効なファイルがあるか検証
  const validFiles = fileMimeTypes.filter((m) => m in VOUCHER_MIME_TYPES);
  if (fileMimeTypes.length > 0 && validFiles.length === 0) {
    // 添付ファイルはあるが証憑として無効
    const accepted = Object.values(VOUCHER_MIME_TYPES).join("、");
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `⚠️ 添付ファイルは証憑として認識できませんでした。対応形式: ${accepted}`,
    });
    console.log(`[file-share] Invalid file types: ${fileMimeTypes.join(", ")}`);
    return;
  }

  // 親メッセージを取得してPO番号を抽出
  let parentText = "";
  try {
    const result = await client.conversations.history({
      channel: channelId,
      latest: threadTs,
      inclusive: true,
      limit: 1,
    });
    parentText = (result.messages?.[0]?.text || "") + " " +
      JSON.stringify(result.messages?.[0]?.blocks || []);
  } catch {
    return;
  }

  // PO番号を抽出（GAS発番形式 PR-XXXX にも対応）
  const poMatch = parentText.match(/(?:PO-\d{6}-\d{4}|PR-\d{4,})/);
  if (!poMatch) return;

  const prNumber = poMatch[0];

  // 証憑種別の推定
  const voucherType = fileNames.length > 0 ? classifyVoucher(fileNames[0]) : "その他証憑";
  const fileFormat = fileMimeTypes.length > 0 ? (VOUCHER_MIME_TYPES[fileMimeTypes[0]] || "不明") : "";

  console.log(`[file-share] 証憑添付検知: ${prNumber} / ${voucherType} (${fileFormat}) in ${channelId}`);

  // GASでステータスを「添付済」に更新 + 証憑種別を記録
  try {
    const gasResult = await updateStatus(prNumber, {
      "証憑対応": "添付済",
      "証憑種別": voucherType,
    });
    if (gasResult.success) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: [
          `📎 証憑を確認しました（${prNumber}）`,
          `種別: ${voucherType} / 形式: ${fileFormat}`,
          `仕訳計上の準備が整いました。`,
        ].join("\n"),
      });
      await notifyOps(client, `📎 *証憑添付* ${prNumber} — ${voucherType} — 仕訳待ちに移行`);
      console.log(`[file-share] GAS updated: ${prNumber} → 添付済 (${voucherType})`);
    }
  } catch (e) {
    console.error(`[file-share] GAS update error for ${prNumber}:`, e);
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
