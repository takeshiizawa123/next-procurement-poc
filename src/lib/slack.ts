import { WebClient } from "@slack/web-api";
import { updateStatus, getStatus, getPendingVouchers, loadPurchaseDraft as _loadPurchaseDraft } from "./gas-client";
import { generatePrediction, isCardPayment } from "./prediction";
import { buildAmountDiffJournal, buildJournalFromPurchase, createJournal } from "./mf-accounting";

/** 開発者用: 全承認権限を持つSlack ID */
const DEV_ADMIN_SLACK_ID = "U04FBAX6MEK"; // 伊澤 剛志

/** GAS更新を実行し、失敗時にSlackスレッドに警告を投稿する */
async function safeUpdateStatus(
  client: WebClient,
  channelId: string,
  threadTs: string,
  poNumber: string,
  updates: Record<string, string>,
  context: string,
): Promise<boolean> {
  try {
    const result = await updateStatus(poNumber, updates);
    if (!result.success) {
      console.error(`[${context}] GAS update returned failure for ${poNumber}:`, {
        error: result.error,
        statusCode: result.statusCode,
        updates,
      });
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `⚠️ ステータス更新に失敗しました（${poNumber}）。原因: ${result.error || "不明"}`,
      }).catch(() => {});
      return false;
    }
    return true;
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.error(`[${context}] GAS update error for ${poNumber}:`, {
      message: errorMessage,
      updates,
      gasUrl: process.env.GAS_WEB_APP_URL ? "configured" : "NOT SET",
    });
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `⚠️ ステータス更新に失敗しました（${poNumber}）。原因: ${errorMessage}`,
    }).catch(() => {});
    return false;
  }
}

/**
 * Slack Web API クライアント
 * Vercel serverless環境ではBoltのReceiverではなく、
 * WebClientを直接使い、ルーティングは自前で行う。
 */

let client: WebClient | null = null;

/**
 * テストモード安全装置（多重防御）
 *
 * このシステムはテスト環境です。本番切替が完了するまで、
 * 従業員への直接DM送信は絶対に行いません。
 *
 * 防御レイヤー:
 * 1. FORCE_TEST_MODE = true（コード内ハードコード、本番切替時のみ解除）
 * 2. 環境変数 TEST_MODE=true（Vercel設定、フォールバック）
 * 3. safeDmChannel() が全DM送信箇所に適用済み
 *
 * 本番切替時の手順:
 * 1. ユーザーの明示的な指示を受ける
 * 2. FORCE_TEST_MODE を false に変更
 * 3. Vercel環境変数 TEST_MODE を false に変更
 * 4. 段階的に特定ユーザーのみ解除してテスト
 */
const FORCE_TEST_MODE = true; // ★ 本番切替まで絶対に変更禁止
const TEST_MODE = FORCE_TEST_MODE || process.env.TEST_MODE === "true";
const TEST_REDIRECT_CHANNEL = process.env.SLACK_PURCHASE_CHANNEL || "";

/**
 * DM送信先を安全なチャンネルにリダイレクトする。
 * テスト環境ではユーザーID宛（U始まり）のDMを全てテストチャンネルにリダイレクトし、
 * 本番ユーザーにテスト通知が届くのを防止する。
 *
 * ★ この関数を経由しないDM送信は禁止。新規DM送信箇所を追加する場合は必ずこの関数を使うこと。
 */
export function safeDmChannel(channel: string): string {
  if (!TEST_MODE) return channel;
  if (channel.startsWith("U")) {
    if (TEST_REDIRECT_CHANNEL) return TEST_REDIRECT_CHANNEL;
    // リダイレクト先未設定でも絶対にユーザーに送らない
    console.error("[slack] CRITICAL: TEST_MODE but no redirect channel — blocking DM to", channel);
    return "BLOCKED";
  }
  return channel;
}

export function getSlackClient(): WebClient {
  if (client) return client;

  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    throw new Error("SLACK_BOT_TOKEN must be set");
  }

  client = new WebClient(botToken);
  return client;
}

// --- ヘルパー ---

/**
 * payload.message.blocks から申請情報（品目・金額・申請者・部門・購入先・支払）を抽出
 */
function extractRequestInfoFromBlocks(
  blocks: Array<{ type: string; fields?: Array<{ text: string }>; text?: { text: string } }>
): { itemName: string; amount: string; applicant: string; department: string; supplierName: string; paymentMethod: string } {
  const defaults = { itemName: "", amount: "", applicant: "", department: "", supplierName: "", paymentMethod: "" };
  const section = blocks.find((b) => b.type === "section" && b.fields);
  if (!section?.fields) return defaults;

  for (const f of section.fields) {
    const t = f.text;
    if (t.startsWith("*品目:*")) defaults.itemName = t.replace("*品目:* ", "");
    else if (t.startsWith("*金額:*")) defaults.amount = t.replace("*金額:* ", "");
    else if (t.startsWith("*申請者:*")) defaults.applicant = t.replace("*申請者:* ", "");
    else if (t.startsWith("*部門:*")) defaults.department = t.replace("*部門:* ", "");
    else if (t.startsWith("*購入先:*")) defaults.supplierName = t.replace("*購入先:* ", "");
    else if (t.startsWith("*支払:*")) defaults.paymentMethod = t.replace("*支払:* ", "");
  }
  return defaults;
}

/**
 * actionValue からパイプ区切りの値を分解
 * 形式: "poNumber|applicantSlackId|approverSlackId|inspectorSlackId|rawAmount|paymentMethod|unitPrice"
 * 後方互換: 旧形式もサポート（unitPriceなければrawAmountにフォールバック）
 */
function parseActionValue(value: string) {
  const [poNumber = "", applicantSlackId = "", approverSlackId = "", inspectorSlackId = "", rawAmount = "0", paymentMethod = "", unitPrice = ""] = value.split("|");
  return { poNumber, applicantSlackId, approverSlackId, inspectorSlackId, rawAmount, paymentMethod, unitPrice: unitPrice || rawAmount };
}

// --- アクションハンドラー ---

export type SlackActionHandler = (params: {
  client: WebClient;
  body: Record<string, unknown>;
  userId: string;
  userName: string;
  channelId: string;
  messageTs: string;
  actionValue: string;
}) => Promise<void>;

/**
 * 承認ボタン押下時の処理（承認者のみ）
 */
export const handleApprove: SlackActionHandler = async ({
  client,
  body,
  userId,
  userName,
  channelId,
  messageTs,
  actionValue,
}) => {
  const { poNumber, approverSlackId } = parseActionValue(actionValue);

  // 権限チェック: 指定された承認者 or 開発者（承認者未設定の場合も拒否）
  const adminMembers = (process.env.SLACK_ADMIN_MEMBERS || "").split(",").filter(Boolean);
  const isAuthorizedApprover = userId === approverSlackId || userId === DEV_ADMIN_SLACK_ID || adminMembers.includes(userId);
  if (!isAuthorizedApprover) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: approverSlackId
        ? "⚠️ この申請の承認権限がありません。承認者として指定された方のみ操作できます。"
        : "⚠️ 承認者が設定されていないため操作できません。管理者に連絡してください。",
    });
    return;
  }

  const message = (body as { message?: { blocks?: Array<{ type: string; fields?: Array<{ text: string }> }> } }).message;
  const info = message?.blocks ? extractRequestInfoFromBlocks(message.blocks) : null;

  // GASステータス更新を先に実行（失敗時はSlackメッセージを更新しない）
  const gasOk = await safeUpdateStatus(client, channelId, messageTs, poNumber, { "発注承認ステータス": "承認済" }, "approve");
  if (!gasOk) {
    await client.chat.postEphemeral({ channel: channelId, user: userId, text: "⚠️ ステータス更新に失敗しました。もう一度お試しください。" });
    return;
  }

  await client.chat.update({
    channel: channelId,
    ts: messageTs,
    blocks: buildApprovedBlocks(poNumber, userName, actionValue, info),
    text: `承認済（${userName}）`,
  });

  await notifyOps(client, `✅ *承認完了* ${poNumber}（${userName} が承認）— ${info?.itemName || ""} ${info?.amount || ""}`);

  // 承認後の通知分岐
  const { applicantSlackId } = parseActionValue(actionValue);
  const amountNum = parseInt((info?.amount || "0").replace(/[^\d]/g, "")) || 0;
  const payMethod = info?.paymentMethod || "";

  // カード払いの場合、予測テーブルに明細を生成（照合用）
  if (isCardPayment(payMethod)) {
    const predictionId = await generatePrediction({
      poNumber,
      applicantSlackId,
      applicantName: info?.applicant?.replace(/<@[^>]+>/g, "").trim() || "",
      amount: amountNum,
      supplierName: info?.supplierName || "",
      paymentMethod: payMethod,
    }).catch((e) => { console.error("[approve] Prediction error:", e); return null; });
    if (!predictionId) {
      // カード情報未登録 → OPSチャネルに警告
      await notifyOps(client, `⚠️ *カード情報未登録* ${poNumber} — <@${applicantSlackId}> の従業員マスタにカード下4桁が未設定のため、照合用予測レコードを生成できませんでした。`);
    }
  }
  // 購入済（立替）判定: メッセージのヘッダーに「購買報告」があるか
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const headerBlock = (message?.blocks as any[])?.find((b) => b.type === "header");
  const isPurchased = headerBlock?.text?.text?.includes("購買報告") || headerBlock?.text?.text?.includes("購入済") || false;

  if (isPurchased) {
    // 購入済（立替）: 発注・検収不要 → 即「証憑待ち」
    if (applicantSlackId) {
      await client.chat.postMessage({
        channel: safeDmChannel(applicantSlackId),
        text: `✅ 購入済申請 ${poNumber} が承認されました。証憑（納品書・領収書）がスレッドに添付されていることを確認してください。`,
      });
    }
    // GASも証憑待ち状態に更新
    await safeUpdateStatus(client, channelId, messageTs, poNumber, {
      "発注ステータス": "発注済",
      "検収ステータス": "検収済",
    }, "approve-purchased");
  } else {
    // 前払い請求書の場合、OPSに先払い依頼を通知
    if (payMethod.includes("前払い")) {
      await notifyOps(
        client,
        `💰 *前払い依頼* ${poNumber} — ${info?.itemName || ""} ${info?.amount || ""}（${info?.supplierName || ""}）\n  → 承認済みです。先払い処理をお願いします。`,
      );
    }

    // 全件: 申請者が発注（カード/請求書問わず）
    const isInvoice = payMethod.includes("請求書");
    if (applicantSlackId) {
      const orderMsg = isInvoice
        ? `✅ 購買申請 ${poNumber} が承認されました。発注してください。\n届いた請求書は管理本部に提出してください。\n発注後、チャンネルの [発注完了] ボタンを押してください。`
        : `✅ 購買申請 ${poNumber} が承認されました。カードで発注してください。\n発注後、チャンネルの [発注完了] ボタンを押してください。`;
      await client.chat.postMessage({
        channel: safeDmChannel(applicantSlackId),
        text: orderMsg,
      });
    }
  }
};

/**
 * 差戻しボタン押下時の処理（承認者のみ）
 */
export const handleReject: SlackActionHandler = async ({
  client,
  body,
  userId,
  userName,
  channelId,
  messageTs,
  actionValue,
}) => {
  const { poNumber, approverSlackId } = parseActionValue(actionValue);

  if (approverSlackId && userId !== approverSlackId) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: "⚠️ この申請の差戻し権限がありません。承認者として指定された方のみ操作できます。",
    });
    return;
  }

  const message = (body as { message?: { blocks?: Array<{ type: string; fields?: Array<{ text: string }> }> } }).message;
  const info = message?.blocks ? extractRequestInfoFromBlocks(message.blocks) : null;

  await client.chat.update({
    channel: channelId,
    ts: messageTs,
    blocks: buildRejectedBlocks(poNumber, userName, info),
    text: `差戻し（${userName}）`,
  });

  // 申請者にDMで差戻し通知（再申請リンク付き）
  const { applicantSlackId } = parseActionValue(actionValue);
  if (applicantSlackId) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "";
    const baseUrl = appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;
    const reapplyUrl = baseUrl ? `${baseUrl}/purchase/new?user_id=${applicantSlackId}` : "";
    await client.chat.postMessage({
      channel: safeDmChannel(applicantSlackId),
      text: [
        `↩️ 購買申請 ${poNumber} が差戻しされました（${userName}）。`,
        `内容を確認のうえ、必要に応じて再申請してください。`,
        ...(reapplyUrl ? [`📝 再申請はこちら: ${reapplyUrl}`] : []),
      ].join("\n"),
    });
  }
};

/**
 * 発注完了ボタン押下時の処理
 * 全件: 申請者が発注（金額・支払方法問わず）
 * 権限: 申請者・承認者・管理本部メンバーが押せる
 */
export const handleOrderComplete: SlackActionHandler = async ({
  client,
  body,
  userId,
  userName,
  channelId,
  messageTs,
  actionValue,
}) => {
  const { poNumber, applicantSlackId, approverSlackId } = parseActionValue(actionValue);
  const adminMembers = (process.env.SLACK_ADMIN_MEMBERS || "").split(",").filter(Boolean);

  const message = (body as { message?: { blocks?: Array<{ type: string; fields?: Array<{ text: string }> }> } }).message;
  const info = message?.blocks ? extractRequestInfoFromBlocks(message.blocks) : null;

  // 権限チェック: 申請者・承認者・管理本部メンバー（全員空なら拒否）
  {
    const allowed = [applicantSlackId, approverSlackId, DEV_ADMIN_SLACK_ID, ...adminMembers].filter(Boolean);
    if (allowed.length === 0 || !allowed.includes(userId)) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: "⚠️ 発注完了の操作権限がありません。",
      });
      return;
    }
  }

  // GASステータス更新を先に実行
  const orderGasOk = await safeUpdateStatus(client, channelId, messageTs, poNumber, { "発注ステータス": "発注済" }, "order");
  if (!orderGasOk) {
    await client.chat.postEphemeral({ channel: channelId, user: userId, text: "⚠️ ステータス更新に失敗しました。もう一度お試しください。" });
    return;
  }

  await client.chat.update({
    channel: channelId,
    ts: messageTs,
    blocks: buildOrderedBlocks(poNumber, userName, actionValue, info),
    text: `発注済（${userName}）`,
  });

  await notifyOps(client, `🛒 *発注完了* ${poNumber}（${userName} が発注）— ${info?.itemName || ""} ${info?.amount || ""}`);

  // 申請者に検収依頼DM
  if (applicantSlackId && applicantSlackId !== userId) {
    await client.chat.postMessage({
      channel: safeDmChannel(applicantSlackId),
      text: `🛒 ${poNumber} が発注されました（${userName}）。届いたら [検収完了] ボタンを押してください。`,
    });
  }
};

/**
 * 部分検収ボタン押下時の処理 → モーダル表示
 */
export const handlePartialInspection: SlackActionHandler = async ({
  client,
  body,
  userId,
  actionValue,
}) => {
  const { poNumber, applicantSlackId, inspectorSlackId } = parseActionValue(actionValue);

  const allowed = [inspectorSlackId, applicantSlackId].filter(Boolean);
  if (allowed.length > 0 && !allowed.includes(userId)) {
    return; // 権限なし — ephemeral は後のハンドラーで処理
  }

  const triggerId = (body as { trigger_id?: string }).trigger_id;
  if (!triggerId) return;

  await client.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "partial_inspection_submit",
      private_metadata: actionValue,
      title: { type: "plain_text", text: "部分検収" },
      submit: { type: "plain_text", text: "検収記録" },
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `*${poNumber}* の部分検収を記録します。` },
        },
        {
          type: "input",
          block_id: "inspected_qty_block",
          label: { type: "plain_text", text: "今回検収した数量" },
          element: {
            type: "number_input",
            action_id: "inspected_qty",
            is_decimal_allowed: false,
            min_value: "1",
            placeholder: { type: "plain_text", text: "例: 5" },
          },
        },
        {
          type: "input",
          block_id: "inspection_note_block",
          label: { type: "plain_text", text: "備考（任意）" },
          optional: true,
          element: {
            type: "plain_text_input",
            action_id: "inspection_note",
            placeholder: { type: "plain_text", text: "例: 第1便分" },
          },
        },
      ],
    },
  });
};

/**
 * 検収完了ボタン押下時の処理（検収者 or 申請者のみ）
 */
export const handleInspectionComplete: SlackActionHandler = async ({
  client,
  body,
  userId,
  userName,
  channelId,
  messageTs,
  actionValue,
}) => {
  const { poNumber, applicantSlackId, inspectorSlackId, rawAmount, unitPrice: unitPriceStr } = parseActionValue(actionValue);

  // 権限チェック: 検収者 or 申請者 or 開発者（全員空なら拒否）
  const inspectionAdminMembers = (process.env.SLACK_ADMIN_MEMBERS || "").split(",").filter(Boolean);
  const inspectionAllowed = [inspectorSlackId, applicantSlackId, DEV_ADMIN_SLACK_ID, ...inspectionAdminMembers].filter(Boolean);
  if (inspectionAllowed.length === 0 || !inspectionAllowed.includes(userId)) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: "⚠️ 検収完了の操作権限がありません。検収者または申請者のみ操作できます。",
    });
    return;
  }

  const message = (body as { message?: { blocks?: Array<{ type: string; fields?: Array<{ text: string }> }> } }).message;
  const info = message?.blocks ? extractRequestInfoFromBlocks(message.blocks) : null;

  // EC連携サイト判定
  const { isEcLinkedSite, VOUCHER_STATUS_MF_AUTO } = await import("@/lib/ec-sites");
  const supplierName = info?.supplierName || "";
  const ecLinked = isEcLinkedSite(supplierName);

  // GASステータス更新を先に実行
  const todayStr = new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
  const inspectionUpdates: Record<string, string> = {
    "検収ステータス": "検収済",
    "検収日": todayStr,
    "証憑対応": ecLinked ? VOUCHER_STATUS_MF_AUTO : "要取得",
  };
  const inspGasOk = await safeUpdateStatus(client, channelId, messageTs, poNumber, inspectionUpdates, "inspection");
  if (!inspGasOk) {
    await client.chat.postEphemeral({ channel: channelId, user: userId, text: "⚠️ ステータス更新に失敗しました。もう一度お試しください。" });
    return;
  }

  await client.chat.update({
    channel: channelId,
    ts: messageTs,
    blocks: buildInspectedBlocks(poNumber, userName, info, actionValue, ecLinked),
    text: `検収済（${userName}）`,
  });

  // スレッドに検収完了メッセージ投稿
  await client.chat.postMessage({
    channel: channelId,
    thread_ts: messageTs,
    text: ecLinked
      ? [
          `✅ 検収記録しました（${userName}）`,
          `🔄 証憑（適格請求書）はMF会計Plusが自動取得します。`,
          `📄 納品書がある場合はこのスレッドに添付してください。`,
        ].join("\n")
      : [
          `✅ 検収記録しました（${userName}）`,
          `📎 証憑（領収書・請求書）をこのスレッドに添付してください。`,
          `📄 納品書がある場合は併せて添付してください。`,
          `⏸️ 証憑が添付されるまで、この案件の経理処理は保留されます。`,
        ].join("\n"),
  });

  await notifyOps(client, ecLinked
    ? `📦 *検収完了* ${poNumber}（${userName} が検収）— EC連携（${supplierName}）証憑MF自動取得`
    : `📦 *検収完了* ${poNumber}（${userName} が検収）— 証憑待ち`);

  // 固定資産通知（単価10万円以上の場合）
  const unitPriceForAsset = parseInt(unitPriceStr, 10);
  if (unitPriceForAsset >= 100000) {
    const itemName = info?.itemName || "";
    const supplier = info?.supplierName || "";
    const department = info?.department || "";
    const today = new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
    const totalAmt = parseInt(rawAmount, 10);
    await notifyOps(
      client,
      `🏷️ 固定資産登録が必要です — ${poNumber}`,
      [
        {
          type: "header",
          text: { type: "plain_text", text: "🏷️ 固定資産登録が必要です" },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*申請番号:*\n${poNumber}` },
            { type: "mrkdwn", text: `*資産名:*\n${itemName}` },
            { type: "mrkdwn", text: `*取得価額:*\n¥${totalAmt.toLocaleString()}` },
            { type: "mrkdwn", text: `*取得日:*\n${today}` },
            { type: "mrkdwn", text: `*部門:*\n${department}` },
            { type: "mrkdwn", text: `*購入先:*\n${supplier}` },
          ],
        },
        { type: "divider" },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: "→ MF固定資産に登録してください" }],
        },
      ],
    );
  }
};

/**
 * 取消ボタン押下時の処理（発注前のみ・申請者のみ）
 */
export const handleCancel: SlackActionHandler = async ({
  client,
  userId,
  userName,
  channelId,
  messageTs,
  actionValue,
}) => {
  const { poNumber, applicantSlackId } = parseActionValue(actionValue);

  // 権限チェック: 申請者のみ取消可能
  if (userId !== applicantSlackId) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: "⚠️ 申請者のみ取消できます",
    });
    return;
  }

  await client.chat.update({
    channel: channelId,
    ts: messageTs,
    blocks: buildCancelledBlocks(poNumber, userName),
    text: `取消済（${userName}）`,
  });
};

function buildCancelledBlocks(poNumber: string, canceller: string) {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: `📋 購買申請 ${poNumber}` },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `🚫 ステータス: *取消済* （${canceller} が取消）`,
        },
      ],
    },
  ];
}

/**
 * 返品ボタン押下時の処理（検収済みの申請に対して）
 * 権限: 申請者・検収者・管理本部メンバー
 */
/**
 * 返品ボタン → モーダルを開く（数量・理由を入力）
 */
export const handleReturn: SlackActionHandler = async ({
  client,
  body,
  userId,
  channelId,
  actionValue,
}) => {
  const { poNumber, applicantSlackId, inspectorSlackId } = parseActionValue(actionValue);
  const adminMembers = (process.env.SLACK_ADMIN_MEMBERS || "").split(",").filter(Boolean);

  const allowed = [applicantSlackId, inspectorSlackId, ...adminMembers].filter(Boolean);
  if (allowed.length > 0 && !allowed.includes(userId)) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: "⚠️ 返品処理の権限がありません。申請者・検収者・管理本部メンバーのみ操作できます。",
    });
    return;
  }

  const triggerId = (body as { trigger_id?: string }).trigger_id;
  if (!triggerId) return;

  const message = (body as { message?: { blocks?: Array<{ type: string; fields?: Array<{ text: string }> }> } }).message;
  const info = message?.blocks ? extractRequestInfoFromBlocks(message.blocks) : null;
  const totalAmount = parseInt((info?.amount || "0").replace(/[^\d]/g, ""), 10);
  // 数量はブロックから直接取得できないため、GASから取得を試みる
  let quantity = 1;
  try {
    const { getStatus } = await import("./gas-client");
    const statusResult = await getStatus(poNumber);
    if (statusResult.success && statusResult.data) {
      quantity = Number((statusResult.data as Record<string, unknown>)["数量"] || 1) || 1;
    }
  } catch { /* フォールバック: 1 */ }

  // private_metadata にコンテキスト情報を埋め込む
  const metadata = JSON.stringify({
    poNumber, channelId, messageTs: ((body as { message?: { ts?: string; thread_ts?: string } }).message?.thread_ts || (body as { message?: { ts?: string } }).message?.ts) || "",
    actionValue, totalAmount, quantity,
    itemName: info?.itemName || "", supplierName: info?.supplierName || "",
    paymentMethod: info?.paymentMethod || "",
  });

  await client.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "return_submit",
      private_metadata: metadata,
      title: { type: "plain_text", text: "返品処理" },
      submit: { type: "plain_text", text: "返品を実行" },
      close: { type: "plain_text", text: "キャンセル" },
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `*${poNumber}* — ${info?.itemName || ""}\n金額: ${info?.amount || ""} / 数量: ${quantity}` },
        },
        {
          type: "input",
          block_id: "return_qty",
          label: { type: "plain_text", text: "返品数量" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            placeholder: { type: "plain_text", text: `全量返品の場合は ${quantity}` },
            initial_value: String(quantity),
          },
          hint: { type: "plain_text", text: `注文数量: ${quantity}。一部返品の場合は返品する数量を入力` },
        },
        {
          type: "input",
          block_id: "return_reason",
          label: { type: "plain_text", text: "返品理由" },
          element: {
            type: "plain_text_input",
            action_id: "value",
            placeholder: { type: "plain_text", text: "例: 商品不良、注文間違い、数量過剰" },
          },
          optional: false,
        },
      ],
    },
  });
};

/**
 * 返品モーダル送信ハンドラ（events/route.ts から呼び出される）
 */
export async function handleReturnSubmit(
  client: WebClient,
  view: { private_metadata: string; state: { values: Record<string, Record<string, { value?: string | null }>> } },
  userId: string,
  userName: string,
): Promise<void> {
  const meta = JSON.parse(view.private_metadata);
  const { poNumber, channelId, messageTs, totalAmount, quantity, itemName, supplierName, paymentMethod } = meta;

  const returnQty = parseInt(view.state.values.return_qty?.value?.value || String(quantity), 10) || quantity;
  const returnReason = view.state.values.return_reason?.value?.value || "";
  const isPartial = returnQty < quantity;
  const returnAmount = quantity > 0 ? Math.round(totalAmount * returnQty / quantity) : totalAmount;

  const message = (await client.conversations.replies({ channel: channelId, ts: messageTs, limit: 1 })).messages?.[0];
  const info = message?.blocks ? extractRequestInfoFromBlocks(message.blocks as Array<{ type: string; fields?: Array<{ text: string }> }>) : null;

  // メッセージ更新
  if (!isPartial) {
    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      blocks: buildReturnedBlocks(poNumber, userName, info),
      text: `返品処理（${userName}）`,
    });
  }

  // 取消仕訳の作成
  let reversalNote = "仕訳が計上済みの場合、管理本部が取消仕訳を作成してください。";
  if (returnAmount > 0) {
    try {
      const { createJournal, resolveAccountCode, resolveTaxCode } = await import("@/lib/mf-accounting");
      const { estimateAccount } = await import("@/lib/account-estimator");

      const estimation = estimateAccount(itemName, supplierName, returnAmount);
      const mainAccount = estimation.account.split("（")[0].trim();
      const debitCode = await resolveAccountCode(mainAccount) || mainAccount;
      const isCard = paymentMethod.includes("カード");
      const creditAccountName = isCard ? "未払金" : "買掛金";
      const creditCode = await resolveAccountCode(creditAccountName) || creditAccountName;
      const taxCode = await resolveTaxCode("共-課仕 10%");
      const taxValue = Math.floor(returnAmount * 10 / 110);

      const journal = await createJournal({
        status: "draft",
        transaction_date: new Date().toISOString().slice(0, 10),
        journal_type: "journal_entry",
        tags: [poNumber, "reversal"],
        memo: `${new Date().toISOString().slice(0, 7).replace("-", "/")} ${poNumber} 返品取消仕訳 ${supplierName}`,
        branches: [
          {
            remark: `${poNumber} ${supplierName} ${isPartial ? `一部返品(${returnQty}/${quantity})` : "全量返品"} ${returnReason}`,
            debitor: { account_code: creditCode, value: returnAmount },
            creditor: { account_code: debitCode, ...(taxCode ? { tax_code: taxCode } : {}), value: returnAmount, tax_value: taxValue },
          },
        ],
      });
      reversalNote = `取消仕訳をドラフト作成しました（MF仕訳ID: ${journal.id} / ¥${returnAmount.toLocaleString()}）。MF会計Plusで確認・承認してください。`;
    } catch (e) {
      console.error("[return] Reversal journal error:", e);
      reversalNote = "取消仕訳の自動作成に失敗しました。管理本部が手動で作成してください。";
    }
  }

  const returnLabel = isPartial ? `一部返品（${returnQty}/${quantity}個 — ¥${returnAmount.toLocaleString()}）` : `全量返品（¥${returnAmount.toLocaleString()}）`;

  await client.chat.postMessage({
    channel: channelId,
    thread_ts: messageTs,
    text: [`↩️ ${returnLabel}（${userName}）`, `理由: ${returnReason}`, reversalNote].join("\n"),
  });

  await notifyOps(client, [
    `↩️ *返品処理* ${poNumber}`,
    `  ${returnLabel}`,
    `  品目: ${itemName}`,
    `  理由: ${returnReason}`,
    `  処理者: ${userName}`,
    `  → ${reversalNote}`,
  ].join("\n"));

  const status = isPartial ? "一部返品" : "返品";
  const note = `${userName}が${isPartial ? `一部返品(${returnQty}/${quantity})` : "全量返品"}: ${returnReason}`;
  await safeUpdateStatus(client, channelId, messageTs, poNumber, { "検収ステータス": status, "備考": note }, "return");
}

function buildReturnedBlocks(
  poNumber: string,
  returner: string,
  info: { itemName: string; amount: string; applicant: string; department: string; supplierName: string; paymentMethod: string } | null,
) {
  const fields = info
    ? [
        { type: "mrkdwn", text: `*品目:* ${info.itemName}` },
        { type: "mrkdwn", text: `*金額:* ${info.amount}` },
        { type: "mrkdwn", text: `*申請者:* ${info.applicant}` },
        { type: "mrkdwn", text: `*購入先:* ${info.supplierName}` },
      ]
    : [];

  return [
    {
      type: "header",
      text: { type: "plain_text", text: `📋 購買申請 ${poNumber}` },
    },
    ...(fields.length > 0 ? [{ type: "section", fields }] : []),
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `↩️ ステータス: *返品処理中* （${returner} が返品処理）`,
        },
      ],
    },
  ];
}

/**
 * DM承認ボタン押下時の処理
 * actionValue: "dm|channelId|messageTs|poNumber|applicantSlackId|approverSlackId|inspectorSlackId"
 */
export const handleDmApprove: SlackActionHandler = async ({
  client,
  userId,
  userName,
  channelId: dmChannelId,
  messageTs: dmMessageTs,
  actionValue,
}) => {
  const parts = actionValue.split("|");
  // parts: [dm, channelId, messageTs, poNumber, applicantSlackId, approverSlackId, inspectorSlackId]
  const origChannelId = parts[1];
  const origMessageTs = parts[2];
  const poNumber = parts[3];
  const approverSlackId = parts[5];

  if (approverSlackId && userId !== approverSlackId && userId !== DEV_ADMIN_SLACK_ID) {
    await client.chat.postEphemeral({
      channel: dmChannelId,
      user: userId,
      text: "⚠️ この申請の承認権限がありません。",
    });
    return;
  }

  // 元チャンネルのメッセージを取得して情報を引き継ぐ
  let info = null;
  try {
    const result = await client.conversations.history({
      channel: origChannelId,
      latest: origMessageTs,
      inclusive: true,
      limit: 1,
    });
    const origMessage = result.messages?.[0];
    if (origMessage?.blocks) {
      info = extractRequestInfoFromBlocks(origMessage.blocks as Array<{ type: string; fields?: Array<{ text: string }> }>);
    }
  } catch {
    console.warn("[dm_approve] Could not fetch original message");
  }

  // 元チャンネルのメッセージを更新
  await client.chat.update({
    channel: origChannelId,
    ts: origMessageTs,
    blocks: buildApprovedBlocks(poNumber, userName, actionValue.substring(actionValue.indexOf("|", actionValue.indexOf("|", actionValue.indexOf("|") + 1) + 1) + 1), info),
    text: `承認済（${userName}）`,
  });

  // DMのボタンを完了表示に更新
  await client.chat.update({
    channel: dmChannelId,
    ts: dmMessageTs,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `✅ *${poNumber}* を承認しました` },
      },
    ],
    text: `承認済 ${poNumber}`,
  });
};

/**
 * DM差戻しボタン押下時の処理
 */
export const handleDmReject: SlackActionHandler = async ({
  client,
  userId,
  userName,
  channelId: dmChannelId,
  messageTs: dmMessageTs,
  actionValue,
}) => {
  const parts = actionValue.split("|");
  const origChannelId = parts[1];
  const origMessageTs = parts[2];
  const poNumber = parts[3];
  const applicantSlackId = parts[4];
  const approverSlackId = parts[5];

  if (approverSlackId && userId !== approverSlackId) {
    await client.chat.postEphemeral({
      channel: dmChannelId,
      user: userId,
      text: "⚠️ この申請の差戻し権限がありません。",
    });
    return;
  }

  let info = null;
  try {
    const result = await client.conversations.history({
      channel: origChannelId,
      latest: origMessageTs,
      inclusive: true,
      limit: 1,
    });
    const origMessage = result.messages?.[0];
    if (origMessage?.blocks) {
      info = extractRequestInfoFromBlocks(origMessage.blocks as Array<{ type: string; fields?: Array<{ text: string }> }>);
    }
  } catch {
    console.warn("[dm_reject] Could not fetch original message");
  }

  await client.chat.update({
    channel: origChannelId,
    ts: origMessageTs,
    blocks: buildRejectedBlocks(poNumber, userName, info),
    text: `差戻し（${userName}）`,
  });

  await client.chat.update({
    channel: dmChannelId,
    ts: dmMessageTs,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `↩️ *${poNumber}* を差戻ししました` },
      },
    ],
    text: `差戻し ${poNumber}`,
  });

  // 申請者にDMで差戻し通知（再申請リンク付き）
  if (applicantSlackId) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "";
    const baseUrl = appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;
    const reapplyUrl = baseUrl ? `${baseUrl}/purchase/new?user_id=${applicantSlackId}` : "";
    await client.chat.postMessage({
      channel: safeDmChannel(applicantSlackId),
      text: [
        `↩️ 購買申請 ${poNumber} が差戻しされました（${userName}）。`,
        `内容を確認のうえ、必要に応じて再申請してください。`,
        ...(reapplyUrl ? [`📝 再申請はこちら: ${reapplyUrl}`] : []),
      ].join("\n"),
    });
  }
};

/**
 * 「Slackモーダルで入力」ボタン押下時 — モーダルを開く
 * ※ block_actionsでは trigger_id が使えるため、ここからモーダルを開ける
 */
export const handleOpenModal: SlackActionHandler = async ({
  client,
  body,
  userId,
  actionValue,
}) => {
  const triggerId = (body as { trigger_id?: string }).trigger_id;
  if (!triggerId) {
    console.error("[purchase_open_modal] No trigger_id in payload");
    return;
  }
  const channelId = actionValue; // value にチャンネルIDを入れている
  const draft = await _loadPurchaseDraft(userId) as Partial<PurchaseFormData> | null;
  await client.views.open({
    trigger_id: triggerId,
    view: buildPurchaseModal(channelId, draft),
  });
};

/**
 * 仕訳登録ボタンハンドラー
 * actionValue: "prNumber" (PO番号)
 */
export const handleJournalRegister: SlackActionHandler = async ({
  client,
  userId,
  channelId,
  messageTs,
  actionValue,
}) => {
  const prNumber = actionValue;
  if (!prNumber) return;

  // 管理本部メンバーのみ実行可能
  const adminMembers = (process.env.SLACK_ADMIN_MEMBERS || "").split(",").filter(Boolean);
  if (adminMembers.length > 0 && !adminMembers.includes(userId)) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: "⚠️ 仕訳登録は管理本部メンバーのみ実行できます。",
    });
    return;
  }

  // 仕訳登録APIを呼び出し
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "";
  const baseUrl = appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;

  try {
    const cronSecret = process.env.CRON_SECRET || "";
    const res = await fetch(`${baseUrl}/api/mf/journal`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
      },
      body: JSON.stringify({ prNumber }),
      signal: AbortSignal.timeout(15000),
    });

    const data = await res.json() as { ok?: boolean; journalId?: number; error?: string };
    if (data.ok) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: `✅ 仕訳登録完了: ${prNumber} → MF仕訳ID: ${data.journalId}`,
      });
    } else {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: `❌ 仕訳登録失敗: ${data.error}`,
      });
    }
  } catch (err) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: `❌ 仕訳登録エラー: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
};

/**
 * 金額差異の再承認リクエストを承認者に送信
 */
export async function sendAmountDiffApproval(
  client: WebClient,
  channelId: string,
  threadTs: string,
  prNumber: string,
  ocrAmount: number,
  requestedAmount: number,
  difference: number,
  approverSlackId: string,
  ocrSubtotal?: number,
): Promise<void> {
  const pctDiff = requestedAmount > 0 ? Math.abs(difference) / requestedAmount * 100 : 0;
  const diffSign = difference > 0 ? "+" : "";
  const actionValue = `${prNumber}|${approverSlackId}|${ocrAmount}|${requestedAmount}|${ocrSubtotal ?? ""}`;

  await client.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    text: `⚠️ 金額差異の再承認が必要です: ${prNumber}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "⚠️ 金額差異 — 再承認リクエスト" },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*申請番号:*\n${prNumber}` },
          { type: "mrkdwn", text: `*承認者:*\n<@${approverSlackId}>` },
          { type: "mrkdwn", text: `*申請金額（税込）:*\n¥${requestedAmount.toLocaleString()}` },
          { type: "mrkdwn", text: `*証憑金額:*\n¥${ocrAmount.toLocaleString()}` },
          { type: "mrkdwn", text: `*差額:*\n${diffSign}¥${difference.toLocaleString()}` },
          { type: "mrkdwn", text: `*乖離率:*\n${pctDiff.toFixed(1)}%` },
        ],
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: "20%超かつ¥1,000超の差異のため再承認が必要です。承認すると証憑金額で処理を続行します。" },
        ],
      },
      {
        type: "actions",
        block_id: "amount_diff_actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "✅ 承認（証憑金額で続行）" },
            style: "primary",
            value: actionValue,
            action_id: "amount_diff_approve_button",
          },
          {
            type: "button",
            text: { type: "plain_text", text: "❌ 却下（差し戻し）" },
            style: "danger",
            value: actionValue,
            action_id: "amount_diff_reject_button",
          },
        ],
      },
    ],
  });
}

/**
 * 金額差異承認ハンドラ
 */
const handleAmountDiffApprove: SlackActionHandler = async ({
  client,
  userId,
  userName,
  channelId,
  messageTs,
  actionValue,
}) => {
  const [prNumber, approverSlackId, ocrAmountStr, requestedAmountStr, subtotalStr] = actionValue.split("|");
  const ocrAmount = Number(ocrAmountStr);

  if (approverSlackId && userId !== approverSlackId && userId !== DEV_ADMIN_SLACK_ID) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: "⚠️ この金額差異の承認権限がありません。",
    });
    return;
  }

  // 証憑金額（税抜）で合計額を上書き
  const ocrSubtotal = subtotalStr ? Number(subtotalStr) : Math.round(ocrAmount / 1.1);
  const gasUpdates: Record<string, string> = {
    "金額照合": `承認済（差額承認: ${userName}）`,
    "合計額（税込）": String(ocrSubtotal),
  };

  await client.chat.update({
    channel: channelId,
    ts: messageTs,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `✅ *金額差異承認済*（${userName}）\n${prNumber}: 証憑¥${ocrAmount.toLocaleString()} / 申請¥${Number(requestedAmountStr).toLocaleString()}\n合計額を証憑ベース（税抜¥${ocrSubtotal.toLocaleString()}）に更新しました` },
      },
    ],
    text: `金額差異承認済（${userName}）`,
  });

  await safeUpdateStatus(client, channelId, messageTs, prNumber, gasUpdates, "amount_diff_approve");

  await notifyOps(client, `✅ *金額差異承認* ${prNumber}（${userName}）— 証憑¥${ocrAmount.toLocaleString()} / 申請¥${Number(requestedAmountStr).toLocaleString()}→ 合計額を税抜¥${ocrSubtotal.toLocaleString()}に更新`);

  // 再承認後: 証憑金額で本仕訳��作成（A案: 差額仕訳ではなく証憑ベースで1本仕訳）
  if (ocrAmount > 0 && process.env.MF_OAUTH_CLIENT_ID) {
    try {
      const statusResult = await getStatus(prNumber);
      const p = (statusResult.success && statusResult.data) ? statusResult.data as Record<string, unknown> : {};
      const txDate = String(p["検収日"] || p["申請日"] || new Date().toISOString().split("T")[0]);
      const itemName = String(p["品目名"] || "");
      const katanaPo = String(p["PO番号"] || "");
      const budgetNum = String(p["予算番号"] || "");
      // 取引先: 国税API確定名 > 発注データの購入先
      const verifiedName = String(p["MF取引先"] || "");
      const supplierName = verifiedName || String(p["購入先"] || "");
      const journalReq = await buildJournalFromPurchase({
        transactionDate: txDate,
        accountTitle: String(p["勘定科目"] || "消耗品費"),
        amount: ocrAmount,  // 証憑金額（税込）で仕訳
        paymentMethod: String(p["支払方法"] || ""),
        supplierName,
        department: String(p["部門"] || ""),
        poNumber: prNumber,
        memo: `金額差異承認済（${userName}）`,
        itemName: itemName || undefined,
        katanaPo: katanaPo || undefined,
        budgetNumber: budgetNum || undefined,
      });
      const journalResult = await createJournal(journalReq);
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: `✅ 仕訳を登録しました（MF仕訳ID: ${journalResult.id} / 証憑金額 ¥${ocrAmount.toLocaleString()}）`,
      });
      await notifyOps(client, `✅ *仕訳登録（再承認後）* ${prNumber} — MF仕訳ID: ${journalResult.id} / 証憑¥${ocrAmount.toLocaleString()}`);

      // GASにStage 1仕訳IDを記録
      await safeUpdateStatus(client, channelId, messageTs, prNumber, {
        "仕訳ID": String(journalResult.id),
        "Stage": "1",
      }, "amount_diff_journal");
    } catch (journalErr) {
      console.error(`[amount_diff] Journal creation failed for ${prNumber}:`, journalErr);
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: `⚠️ 仕訳の自動登録に失敗しました。手動で登録してください。（${journalErr instanceof Error ? journalErr.message : String(journalErr)}）`,
      });
    }
  }
};

/**
 * 金額差異却下ハンドラ
 */
const handleAmountDiffReject: SlackActionHandler = async ({
  client,
  userId,
  userName,
  channelId,
  messageTs,
  actionValue,
}) => {
  const [prNumber, approverSlackId, ocrAmountStr, requestedAmountStr] = actionValue.split("|");

  if (approverSlackId && userId !== approverSlackId) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: "⚠️ この金額差異の却下権限がありません。",
    });
    return;
  }

  await client.chat.update({
    channel: channelId,
    ts: messageTs,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `❌ *金額差異却下*（${userName}）\n${prNumber}: 証憑¥${Number(ocrAmountStr).toLocaleString()} / 申請¥${Number(requestedAmountStr).toLocaleString()}\n申請者に差し戻しが必要です。` },
      },
    ],
    text: `金額差異却下（${userName}）`,
  });

  await safeUpdateStatus(client, channelId, messageTs, prNumber, {
    "金額照合": `却下（差額却下: ${userName}）`,
    "Stage": "差し戻し",
  }, "amount_diff_reject");

  await notifyOps(client, `❌ *金額差異却下* ${prNumber}（${userName}）— 証憑¥${Number(ocrAmountStr).toLocaleString()} / 申請¥${Number(requestedAmountStr).toLocaleString()}`);
};

// アクションIDとハンドラーのマッピング
export const actionHandlers: Record<string, SlackActionHandler> = {
  approve_button: handleApprove,
  reject_button: handleReject,
  order_complete_button: handleOrderComplete,
  inspection_complete_button: handleInspectionComplete,
  partial_inspection_button: handlePartialInspection,
  cancel_button: handleCancel,
  return_button: handleReturn,
  dm_approve_button: handleDmApprove,
  dm_reject_button: handleDmReject,
  purchase_open_modal: handleOpenModal,
  journal_register_button: handleJournalRegister,
  amount_diff_approve_button: handleAmountDiffApprove,
  amount_diff_reject_button: handleAmountDiffReject,
};

// --- /purchase モーダル ---

/**
 * /purchase コマンド → モーダル or Webフォーム選択
 */
export async function handlePurchaseCommand(
  slackClient: WebClient,
  triggerId: string,
  channelId: string,
  userId: string,
): Promise<"modal" | "chooser"> {
  const webFormUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;

  // Webフォーム URL が設定されていない場合はモーダル直接表示
  if (!webFormUrl) {
    const draft = await _loadPurchaseDraft(userId) as Partial<PurchaseFormData> | null;
    await slackClient.views.open({
      trigger_id: triggerId,
      view: buildPurchaseModal(channelId, draft),
    });
    return "modal";
  }

  // 2択をモーダルで表示（プライベートチャンネルでのephemeral失敗を回避）
  const formUrl = `${webFormUrl.startsWith("http") ? webFormUrl : `https://${webFormUrl}`}/purchase/new?user_id=${userId}&channel_id=${channelId}`;

  await slackClient.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      title: { type: "plain_text", text: "購買申請" },
      close: { type: "plain_text", text: "閉じる" },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*入力方法を選んでください*",
          },
        },
        {
          type: "actions",
          block_id: "purchase_chooser",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "📱 Slackモーダルで入力" },
              value: channelId,
              action_id: "purchase_open_modal",
          },
          {
            type: "button",
            text: { type: "plain_text", text: "🌐 Webフォームで入力" },
            url: formUrl,
            action_id: "purchase_open_web",
          },
        ],
      },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "💡 Webフォームではファイルアップロードや入力補助が利用できます",
            },
          ],
        },
      ],
    },
  });
  return "chooser";
}

/**
 * 購買申請モーダル
 */
// --- 下書き保存（GASスプレッドシート永続化、1か月自動消去） ---
// GAS側で saveDraft / loadDraft / clearDraft アクションを実装する前提

export { savePurchaseDraft, loadPurchaseDraft, clearPurchaseDraft } from "./gas-client";

function buildPurchaseModal(channelId: string, draft?: Partial<PurchaseFormData> | null) {
  const d = draft || {};
  return {
    type: "modal" as const,
    callback_id: "purchase_submit",
    private_metadata: channelId,
    title: { type: "plain_text" as const, text: "購買申請" },
    submit: { type: "plain_text" as const, text: "申請する" },
    close: { type: "plain_text" as const, text: "キャンセル" },
    blocks: [
      // 1. 申請区分
      {
        type: "input",
        block_id: "request_type",
        label: { type: "plain_text", text: "申請区分" },
        element: {
          type: "static_select",
          action_id: "request_type_select",
          placeholder: { type: "plain_text", text: "選択してください" },
          options: [
            { text: { type: "plain_text", text: "購入前" }, value: "購入前" },
            { text: { type: "plain_text", text: "購入済" }, value: "購入済" },
            { text: { type: "plain_text", text: "🚨 緊急事後報告" }, value: "緊急事後報告" },
          ],
        },
      },
      // 2. 品目名
      {
        type: "input",
        block_id: "item_name",
        label: { type: "plain_text", text: "品目名" },
        element: {
          type: "plain_text_input",
          action_id: "item_name_input",
          placeholder: { type: "plain_text", text: "例: ノートPC、モニター等" },
          ...(d.itemName ? { initial_value: d.itemName } : {}),
        },
      },
      // 3. 金額（税込）
      {
        type: "input",
        block_id: "amount",
        label: { type: "plain_text", text: "単価（税込・円）" },
        hint: { type: "plain_text", text: "1個あたりの税込金額を入力。合計は「単価×数量」で自動計算されます" },
        element: {
          type: "plain_text_input",
          action_id: "amount_input",
          placeholder: { type: "plain_text", text: "例: 165000" },
          ...(d.amount ? { initial_value: String(d.amount) } : {}),
        },
      },
      // 3b. 概算チェックボックス
      {
        type: "input",
        block_id: "is_estimate",
        label: { type: "plain_text", text: "金額の確度" },
        optional: true,
        element: {
          type: "checkboxes",
          action_id: "is_estimate_check",
          options: [
            {
              text: { type: "plain_text", text: "📐 概算（金額未確定）" },
              value: "estimate",
              description: { type: "plain_text", text: "実額確定後にMFカード明細と自動比較されます" },
            },
          ],
        },
      },
      // 3c. 購入日（事後報告用）
      {
        type: "input",
        block_id: "purchase_date",
        label: { type: "plain_text", text: "購入日（事後報告の場合）" },
        hint: { type: "plain_text", text: "緊急事後報告の場合は購入日を選択してください" },
        optional: true,
        element: { type: "datepicker", action_id: "purchase_date_picker" },
      },
      // 3d. 緊急理由（事後報告用）
      {
        type: "input",
        block_id: "emergency_reason",
        label: { type: "plain_text", text: "緊急理由（事後報告の場合）" },
        hint: { type: "plain_text", text: "緊急事後報告の場合は必ず記入してください" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "emergency_reason_input",
          multiline: true,
          placeholder: { type: "plain_text", text: "例: 出張先で急遽必要になったため" },
        },
      },
      // 4. 数量
      {
        type: "input",
        block_id: "quantity",
        label: { type: "plain_text", text: "数量" },
        element: {
          type: "plain_text_input",
          action_id: "quantity_input",
          placeholder: { type: "plain_text", text: "1" },
          initial_value: d.quantity ? String(d.quantity) : "1",
        },
      },
      // 5. 支払方法
      {
        type: "input",
        block_id: "payment_method",
        label: { type: "plain_text", text: "支払方法" },
        element: {
          type: "static_select",
          action_id: "payment_method_select",
          placeholder: { type: "plain_text", text: "選択してください" },
          options: [
            { text: { type: "plain_text", text: "MFカード" }, value: "MFカード" },
            { text: { type: "plain_text", text: "請求書払い" }, value: "請求書払い" },
            { text: { type: "plain_text", text: "請求書払い（前払い）" }, value: "請求書払い（前払い）" },
            { text: { type: "plain_text", text: "立替" }, value: "立替" },
          ],
        },
      },
      // 6. 購入先名
      {
        type: "input",
        block_id: "supplier_name",
        label: { type: "plain_text", text: "購入先名" },
        hint: { type: "plain_text", text: "正式名称で入力（例: 株式会社アルコム）" },
        element: {
          type: "plain_text_input",
          action_id: "supplier_name_input",
          placeholder: { type: "plain_text", text: "例: Amazon、モノタロウ、ASKUL、株式会社○○" },
          ...(d.supplierName ? { initial_value: d.supplierName } : {}),
        },
      },
      // 7. 購入先URL（任意）
      {
        type: "input",
        block_id: "url",
        label: { type: "plain_text", text: "購入先URL" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "url_input",
          placeholder: { type: "plain_text", text: "https://www.amazon.co.jp/..." },
          ...(d.url ? { initial_value: d.url } : {}),
        },
      },
      // 8. 検収者
      {
        type: "input",
        block_id: "inspector",
        label: { type: "plain_text", text: "検収者" },
        hint: { type: "plain_text", text: "届いた品物を確認する人。通常は申請者本人" },
        element: {
          type: "users_select",
          action_id: "inspector_select",
          placeholder: { type: "plain_text", text: "検収者を選択" },
        },
      },
      // 9. 購入品の用途（10万以上の場合のみ回答）
      {
        type: "input",
        block_id: "asset_usage",
        label: { type: "plain_text", text: "購入品の用途" },
        hint: { type: "plain_text", text: "単価10万円以上の場合のみ回答してください" },
        optional: true,
        element: {
          type: "static_select",
          action_id: "asset_usage_select",
          placeholder: { type: "plain_text", text: "10万円以上の場合に選択" },
          options: [
            { text: { type: "plain_text", text: "顧客案件に使用する（納品・組込等）" }, value: "顧客案件" },
            { text: { type: "plain_text", text: "社内で使用する" }, value: "社内使用" },
            { text: { type: "plain_text", text: "予備品として保管する" }, value: "予備品" },
          ],
        },
      },
      // 10. KATANA PO番号（任意）
      {
        type: "input",
        block_id: "katana_po",
        label: { type: "plain_text", text: "KATANA PO番号" },
        hint: { type: "plain_text", text: "製品部品の場合に入力" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "katana_po_input",
          placeholder: { type: "plain_text", text: "例: PO-12345" },
          ...(d.katanaPo ? { initial_value: d.katanaPo } : {}),
        },
      },
      // 11. HubSpot案件番号（任意）
      {
        type: "input",
        block_id: "hubspot_deal_id",
        label: { type: "plain_text", text: "HubSpot案件番号" },
        hint: { type: "plain_text", text: "案件利用でプロジェクトコードを持っている場合は必ず入力" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "hubspot_deal_id_input",
          placeholder: { type: "plain_text", text: "例: 12345678" },
          ...(d.hubspotDealId ? { initial_value: d.hubspotDealId } : {}),
        },
      },
      // 12. 実行予算番号（任意）
      {
        type: "input",
        block_id: "budget_number",
        label: { type: "plain_text", text: "実行予算番号" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "budget_number_input",
          placeholder: { type: "plain_text", text: "あれば入力" },
          ...(d.budgetNumber ? { initial_value: d.budgetNumber } : {}),
        },
      },
      // 13. 証憑案内
      {
        type: "context",
        block_id: "voucher_notice",
        elements: [
          {
            type: "mrkdwn",
            text: "📎 *証憑（納品書・領収書等）* は申請後にスレッドへ添付してください。購入済の場合は必須です。",
          },
        ],
      },
      // 14. 購入理由（PO/HubSpot/予算番号があれば省略可）
      {
        type: "input",
        block_id: "notes",
        label: { type: "plain_text", text: "購入理由" },
        hint: { type: "plain_text", text: "PO番号・HubSpot案件番号・実行予算番号のいずれかがあれば省略可。それ以外は必ず記入してください" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "notes_input",
          multiline: true,
          placeholder: { type: "plain_text", text: "例: 開発用デバッグ機材として必要 / 社内会議用モニター購入 / ○○プロジェクトの量産部品" },
          ...(d.notes ? { initial_value: d.notes } : {}),
        },
      },
    ],
  };
}

/**
 * モーダル送信データからフォーム値を抽出
 */
export interface PurchaseFormData {
  requestType: string;
  itemName: string;
  amount: number;
  quantity: number;
  paymentMethod: string;
  supplierName: string;
  url: string;
  inspectorSlackId: string;
  assetUsage: string;
  katanaPo: string;
  hubspotDealId: string;
  budgetNumber: string;
  notes: string;
  /** 概算フラグ — 金額未確定の場合 true */
  isEstimate: boolean;
  /** 緊急理由（事後報告の場合のみ） */
  emergencyReason: string;
  /** 購入日（事後報告の場合のみ） */
  purchaseDate: string;
}

export function parsePurchaseFormValues(
  values: Record<string, Record<string, { value?: string; selected_option?: { value: string }; selected_user?: string }>>
): PurchaseFormData {
  const get = (blockId: string, actionId: string): string => {
    const block = values[blockId]?.[actionId];
    return block?.selected_option?.value ?? block?.selected_user ?? block?.value ?? "";
  };

  const amount = parseInt(get("amount", "amount_input").replace(/[,，]/g, ""), 10) || 0;
  const quantity = parseInt(get("quantity", "quantity_input"), 10) || 1;

  // 概算チェックボックスの解析
  const estimateBlock = values["is_estimate"]?.["is_estimate_check"];
  const selectedOptions = (estimateBlock as { selected_options?: { value: string }[] })?.selected_options || [];
  const isEstimate = selectedOptions.some((o: { value: string }) => o.value === "estimate");

  return {
    requestType: get("request_type", "request_type_select"),
    itemName: get("item_name", "item_name_input"),
    amount,
    quantity,
    paymentMethod: get("payment_method", "payment_method_select"),
    supplierName: get("supplier_name", "supplier_name_input"),
    url: get("url", "url_input"),
    inspectorSlackId: get("inspector", "inspector_select"),
    assetUsage: get("asset_usage", "asset_usage_select"),
    katanaPo: get("katana_po", "katana_po_input"),
    hubspotDealId: get("hubspot_deal_id", "hubspot_deal_id_input"),
    budgetNumber: get("budget_number", "budget_number_input"),
    notes: get("notes", "notes_input"),
    isEstimate,
    emergencyReason: get("emergency_reason", "emergency_reason_input"),
    purchaseDate: get("purchase_date", "purchase_date_picker"),
  };
}

// --- スラッシュコマンドハンドラー ---

export async function handlePoTestCommand(
  slackClient: WebClient,
  channelId: string,
  userId: string
): Promise<void> {
  const poNumber = `PO-${new Date().getFullYear()}-TEST`;

  const approverSlackId = process.env.SLACK_DEFAULT_APPROVER || "";

  const requestInfo: RequestInfo = {
    poNumber,
    itemName: "テスト品目（ノートPC）",
    amount: "¥150,000",
    applicant: `<@${userId}>`,
    department: "テスト部門",
    supplierName: "Amazon",
    paymentMethod: "MFカード",
    applicantSlackId: userId,
    approverSlackId,
    inspectorSlackId: userId,
  };

  await slackClient.chat.postMessage({
    channel: channelId,
    blocks: buildNewRequestBlocks(requestInfo),
    text: `購買申請: ${poNumber}`,
  });
}

// --- Block Kit メッセージ構築 ---

export interface RequestInfo {
  poNumber: string;
  itemName: string;
  amount: string;
  unitPrice?: number; // 単価（固定資産判定用）
  applicant: string;
  department: string;
  supplierName: string;
  paymentMethod: string;
  applicantSlackId: string;
  approverSlackId: string;
  inspectorSlackId: string;
  paymentDueDate?: string; // 支払期日 YYYY-MM-DD（請求書払い用）
}

/**
 * 請求書払いの支払期日を計算（月末締め翌月末払い）
 */
export function calcPaymentDueDate(baseDate?: Date): string {
  const d = baseDate || new Date();
  // 当月末締め → 翌月末
  const nextMonth = new Date(d.getFullYear(), d.getMonth() + 2, 0);
  return nextMonth.toISOString().slice(0, 10);
}

/**
 * actionValue 共通形式: "poNumber|applicantSlackId|approverSlackId|inspectorSlackId|rawAmount|paymentMethod|unitPrice"
 */
function buildActionValue(info: RequestInfo): string {
  const rawAmount = info.amount.replace(/[^\d]/g, "") || "0";
  const unitPrice = info.unitPrice ? String(info.unitPrice) : rawAmount;
  return `${info.poNumber}|${info.applicantSlackId}|${info.approverSlackId}|${info.inspectorSlackId}|${rawAmount}|${info.paymentMethod}|${unitPrice}`;
}

export function buildNewRequestBlocks(info: RequestInfo) {
  const av = buildActionValue(info);
  return [
    {
      type: "header",
      text: { type: "plain_text", text: `📋 購買申請 ${info.poNumber}` },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*品目:* ${info.itemName}` },
        { type: "mrkdwn", text: `*金額:* ${info.amount}` },
        { type: "mrkdwn", text: `*申請者:* ${info.applicant}` },
        { type: "mrkdwn", text: `*部門:* ${info.department}` },
        { type: "mrkdwn", text: `*購入先:* ${info.supplierName}` },
        { type: "mrkdwn", text: `*支払:* ${info.paymentMethod}${info.paymentDueDate ? `（期日: ${info.paymentDueDate}）` : ""}` },
      ],
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: "🔵 ステータス: *承認待ち*" }],
    },
    { type: "divider" },
    {
      type: "actions",
      block_id: "approval_actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "✅ 承認" },
          style: "primary",
          value: av,
          action_id: "approve_button",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "↩️ 差戻し" },
          style: "danger",
          value: av,
          action_id: "reject_button",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "🚫 取消" },
          value: av,
          action_id: "cancel_button",
        },
      ],
    },
  ];
}

/**
 * 承認者にDMで承認依頼を送信
 */
export async function sendApprovalDM(
  slackClient: WebClient,
  info: RequestInfo,
  channelId: string,
  messageTs: string,
): Promise<void> {
  if (!info.approverSlackId) return;

  const av = buildActionValue(info);
  const channelLink = `https://slack.com/archives/${channelId}/p${messageTs.replace(".", "")}`;

  // 申請者の証憑未提出一覧を取得
  let pendingWarning = "";
  try {
    const pendingResult = await getPendingVouchers(info.applicant);
    if (pendingResult.success && pendingResult.data?.pending?.length) {
      const items = pendingResult.data.pending;
      pendingWarning = `\n⚠️ *${info.applicant} の証憑未提出案件: ${items.length}件*\n` +
        items.map((p) => `  • ${p.prNumber}: ${p.itemName}（${p.daysElapsed}日経過）`).join("\n");
    }
  } catch { /* ignore */ }

  const blocks = [
    {
      type: "header" as const,
      text: { type: "plain_text" as const, text: `📋 承認依頼 ${info.poNumber}` },
    },
    {
      type: "section" as const,
      fields: [
        { type: "mrkdwn" as const, text: `*品目:* ${info.itemName}` },
        { type: "mrkdwn" as const, text: `*金額:* ${info.amount}` },
        { type: "mrkdwn" as const, text: `*申請者:* ${info.applicant}` },
        { type: "mrkdwn" as const, text: `*購入先:* ${info.supplierName}` },
        { type: "mrkdwn" as const, text: `*支払:* ${info.paymentMethod}` },
      ],
    },
    {
      type: "context" as const,
      elements: [
        { type: "mrkdwn" as const, text: `<${channelLink}|チャンネルで確認>` },
      ],
    },
  ];

  // 未提出案件がある場合に警告セクションを追加
  if (pendingWarning) {
    blocks.push({
      type: "section" as const,
      fields: [{ type: "mrkdwn" as const, text: pendingWarning }],
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allBlocks: any[] = [
    ...blocks,
    { type: "divider" },
    {
      type: "actions",
        block_id: "dm_approval_actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "✅ 承認" },
            style: "primary",
            value: `dm|${channelId}|${messageTs}|${av}`,
            action_id: "dm_approve_button",
          },
          {
            type: "button",
            text: { type: "plain_text", text: "↩️ 差戻し" },
            style: "danger",
            value: `dm|${channelId}|${messageTs}|${av}`,
            action_id: "dm_reject_button",
          },
        ],
      },
  ];

  await slackClient.chat.postMessage({
    channel: safeDmChannel(info.approverSlackId),
    text: `📋 承認依頼: ${info.poNumber} ${info.itemName} ${info.amount}（申請者: ${info.applicant}）${pendingWarning}`,
    blocks: allBlocks,
  });
}

function buildApprovedBlocks(
  poNumber: string,
  approver: string,
  actionValue: string,
  info: { itemName: string; amount: string; applicant: string; department: string; supplierName: string; paymentMethod: string } | null,
) {
  const fields = info
    ? [
        { type: "mrkdwn", text: `*品目:* ${info.itemName}` },
        { type: "mrkdwn", text: `*金額:* ${info.amount}` },
        { type: "mrkdwn", text: `*申請者:* ${info.applicant}` },
        { type: "mrkdwn", text: `*部門:* ${info.department}` },
        { type: "mrkdwn", text: `*購入先:* ${info.supplierName}` },
        { type: "mrkdwn", text: `*支払:* ${info.paymentMethod}` },
      ]
    : [
        { type: "mrkdwn", text: `*品目:* (情報なし)` },
        { type: "mrkdwn", text: `*金額:* (情報なし)` },
      ];

  return [
    {
      type: "header",
      text: { type: "plain_text", text: `📋 購買申請 ${poNumber}` },
    },
    { type: "section", fields },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `🟢 ステータス: *承認済* （${approver} が承認）`,
        },
      ],
    },
    { type: "divider" },
    {
      type: "actions",
      block_id: "order_actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "🛒 発注完了" },
          style: "primary",
          value: actionValue,
          action_id: "order_complete_button",
        },
      ],
    },
  ];
}

function buildRejectedBlocks(
  poNumber: string,
  rejector: string,
  info: { itemName: string; amount: string; applicant: string; department: string; supplierName: string; paymentMethod: string } | null,
) {
  const fields = info
    ? [
        { type: "mrkdwn", text: `*品目:* ${info.itemName}` },
        { type: "mrkdwn", text: `*金額:* ${info.amount}` },
        { type: "mrkdwn", text: `*申請者:* ${info.applicant}` },
        { type: "mrkdwn", text: `*部門:* ${info.department}` },
        { type: "mrkdwn", text: `*購入先:* ${info.supplierName}` },
        { type: "mrkdwn", text: `*支払:* ${info.paymentMethod}` },
      ]
    : [
        { type: "mrkdwn", text: `*品目:* (情報なし)` },
        { type: "mrkdwn", text: `*金額:* (情報なし)` },
      ];

  return [
    {
      type: "header",
      text: { type: "plain_text", text: `📋 購買申請 ${poNumber}` },
    },
    { type: "section", fields },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `🔴 ステータス: *差戻し* （${rejector} が差戻し）`,
        },
      ],
    },
  ];
}

function buildOrderedBlocks(
  poNumber: string,
  orderer: string,
  actionValue: string,
  info: { itemName: string; amount: string; applicant: string; department: string; supplierName: string; paymentMethod: string } | null,
) {
  const fields = info
    ? [
        { type: "mrkdwn", text: `*品目:* ${info.itemName}` },
        { type: "mrkdwn", text: `*金額:* ${info.amount}` },
        { type: "mrkdwn", text: `*申請者:* ${info.applicant}` },
        { type: "mrkdwn", text: `*部門:* ${info.department}` },
        { type: "mrkdwn", text: `*購入先:* ${info.supplierName}` },
        { type: "mrkdwn", text: `*支払:* ${info.paymentMethod}` },
      ]
    : [
        { type: "mrkdwn", text: `*品目:* (情報なし)` },
        { type: "mrkdwn", text: `*金額:* (情報なし)` },
      ];

  return [
    {
      type: "header",
      text: { type: "plain_text", text: `📋 購買申請 ${poNumber}` },
    },
    { type: "section", fields },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `🟡 ステータス: *発注済* （${orderer} が発注完了）`,
        },
      ],
    },
    { type: "divider" },
    {
      type: "actions",
      block_id: "inspection_actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "✅ 全数検収" },
          style: "primary",
          value: actionValue,
          action_id: "inspection_complete_button",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "📦 部分検収" },
          value: actionValue,
          action_id: "partial_inspection_button",
        },
      ],
    },
  ];
}

function buildInspectedBlocks(
  poNumber: string,
  inspector: string,
  info: { itemName: string; amount: string; applicant: string; department: string; supplierName: string; paymentMethod: string } | null,
  actionValue?: string,
  ecLinked = false,
) {
  const fields = info
    ? [
        { type: "mrkdwn", text: `*品目:* ${info.itemName}` },
        { type: "mrkdwn", text: `*金額:* ${info.amount}` },
        { type: "mrkdwn", text: `*申請者:* ${info.applicant}` },
        { type: "mrkdwn", text: `*部門:* ${info.department}` },
        { type: "mrkdwn", text: `*購入先:* ${info.supplierName}` },
        { type: "mrkdwn", text: `*支払:* ${info.paymentMethod}` },
      ]
    : [
        { type: "mrkdwn", text: `*品目:* (情報なし)` },
        { type: "mrkdwn", text: `*金額:* (情報なし)` },
      ];

  return [
    {
      type: "header",
      text: { type: "plain_text", text: `📋 購買申請 ${poNumber}` },
    },
    { type: "section", fields },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: ecLinked
            ? `🟢 ステータス: *検収済・証憑MF自動取得* （${inspector} が検収）`
            : `🟠 ステータス: *検収済・証憑待ち* （${inspector} が検収）`,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: ecLinked
          ? "🔄 *証憑はMF会計Plusが自動取得します*\n📄 納品書がある場合はスレッドに添付してください"
          : "📎 *証憑（領収書・請求書）をこのスレッドに添付してください*\n⏸️ 証憑が揃うまで経理処理は保留されます",
      },
    },
    ...(actionValue
      ? [
          { type: "divider" },
          {
            type: "actions",
            block_id: "post_inspection_actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "↩️ 返品" },
                style: "danger",
                value: actionValue,
                action_id: "return_button",
                confirm: {
                  title: { type: "plain_text", text: "返品処理" },
                  text: { type: "plain_text", text: "この購買の返品処理を行いますか？仕訳が計上済みの場合、管理本部が取消仕訳を作成します。" },
                  confirm: { type: "plain_text", text: "返品する" },
                  deny: { type: "plain_text", text: "キャンセル" },
                },
              },
            ],
          },
        ]
      : []),
  ];
}

// --- 購入済フロー（承認・発注スキップ） ---

/**
 * 購入済申請用のメッセージブロック（即「検収済・証憑待ち」）
 */
export function buildPurchasedRequestBlocks(info: RequestInfo) {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: `📋 購買申請 ${info.poNumber}` },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*品目:* ${info.itemName}` },
        { type: "mrkdwn", text: `*金額:* ${info.amount}` },
        { type: "mrkdwn", text: `*申請者:* ${info.applicant}` },
        { type: "mrkdwn", text: `*部門:* ${info.department}` },
        { type: "mrkdwn", text: `*購入先:* ${info.supplierName}` },
        { type: "mrkdwn", text: `*支払:* ${info.paymentMethod}` },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "📦 *購入済申請* — 承認・発注ステップをスキップ",
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `🟠 ステータス: *検収済・証憑待ち*`,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "📎 *納品書・領収書をこのスレッドに添付してください*\n⏸️ 証憑が揃うまで経理処理は保留されます",
      },
    },
  ];
}

// --- #purchase-ops 通知 ---

const OPS_CHANNEL = process.env.SLACK_OPS_CHANNEL || "";

/**
 * #purchase-ops に通知を送信
 */
export async function notifyOps(
  slackClient: WebClient,
  text: string,
  blocks?: Array<Record<string, unknown>>,
): Promise<void> {
  if (!OPS_CHANNEL) {
    console.warn("[ops] SLACK_OPS_CHANNEL is not set, skipping notification");
    return;
  }
  try {
    await slackClient.chat.postMessage({
      channel: OPS_CHANNEL,
      text,
      ...(blocks ? { blocks } : {}),
    });
  } catch (error) {
    console.error("[ops] Failed to notify:", error);
  }
}

/**
 * Web操作後にSlackメッセージのブロックを更新する
 * GASデータから申請情報を組み立て、アクションに応じたブロックに書き換え
 */
export async function updateSlackMessageForWebAction(
  prNumber: string,
  action: string,
  operatorName: string,
  purchaseData: Record<string, unknown>,
): Promise<void> {
  const channelId = process.env.SLACK_PURCHASE_CHANNEL || "";
  const rawTs = purchaseData["スレッドTS"];

  // スレッドTSを解決（GASが数値に変換して精度が落ちる問題の対策）
  let threadTs = "";
  if (typeof rawTs === "number" && rawTs > 0) {
    // 精度が落ちている可能性 → Slack APIで周辺検索して正確なTSを特定
    const approxTs = rawTs.toFixed(6);
    const client = getSlackClient();
    try {
      const history = await client.conversations.history({
        channel: channelId,
        latest: String(Math.ceil(rawTs) + 1),
        oldest: String(Math.floor(rawTs) - 1),
        limit: 5,
      });
      const match = history.messages?.find((m) =>
        m.text?.includes(prNumber) || JSON.stringify(m.blocks)?.includes(prNumber),
      );
      threadTs = match?.ts || approxTs;
    } catch {
      threadTs = approxTs;
    }
  } else if (rawTs) {
    threadTs = String(rawTs);
  }
  if (!channelId || !threadTs) {
    // TS解決失敗 → OPSチャンネルに警告を投稿
    console.warn(`[slack-update] ${prNumber}: スレッドTS解決失敗（channelId=${!!channelId}, threadTs=${!!threadTs}）`);
    try {
      const warnClient = getSlackClient();
      await notifyOps(
        warnClient,
        `⚠️ *Slackメッセージ更新失敗* — ${prNumber} のスレッドTSが解決できませんでした\nアクション: ${action}（${operatorName}）\nGASデータのスレッドTSを確認してください`,
      );
    } catch { /* Slack通知失敗は無視 */ }
    return;
  }

  const client = getSlackClient();

  // GASデータからブロック用infoを構築
  const totalAmount = Number(purchaseData["合計額（税込）"] || purchaseData["合計額（税抜）"] || 0);
  const info = {
    itemName: String(purchaseData["品目名"] || ""),
    amount: totalAmount > 0 ? `¥${totalAmount.toLocaleString()}` : "",
    applicant: String(purchaseData["申請者"] || ""),
    department: String(purchaseData["部門"] || ""),
    supplierName: String(purchaseData["購入先名"] || purchaseData["購入先"] || ""),
    paymentMethod: String(purchaseData["支払方法"] || ""),
  };

  // actionValueを構築（ボタンの次アクション用）
  const applicantSlackId = String(purchaseData["申請者SlackID"] || purchaseData["申請者"] || "");
  const approverSlackId = String(purchaseData["承認者SlackID"] || purchaseData["承認者"] || "");
  const inspectorSlackId = String(purchaseData["検収者"] || "");
  const unitPrice = String(purchaseData["単価（税込・円）"] || purchaseData["単価"] || "0");
  const actionValue = [
    prNumber, applicantSlackId, approverSlackId, inspectorSlackId,
    String(totalAmount), info.paymentMethod, unitPrice,
  ].join("|");

  let blocks: Record<string, unknown>[] | undefined;
  let text = "";

  switch (action) {
    case "approve":
      blocks = buildApprovedBlocks(prNumber, operatorName, actionValue, info);
      text = `承認済（${operatorName}・Web経由）`;
      break;
    case "reject":
      blocks = buildRejectedBlocks(prNumber, operatorName, info);
      text = `差戻し（${operatorName}・Web経由）`;
      break;
    case "order_complete":
      blocks = buildOrderedBlocks(prNumber, operatorName, actionValue, info);
      text = `発注済（${operatorName}・Web経由）`;
      break;
    case "inspection_complete": {
      const { isEcLinkedSite: isEc } = await import("@/lib/ec-sites");
      blocks = buildInspectedBlocks(prNumber, operatorName, info, actionValue, isEc(info?.supplierName || ""));
      text = `検収済（${operatorName}・Web経由）`;
    }
      break;
    case "cancel":
      // 取消は専用ブロックなし → contextでステータスのみ更新
      blocks = [
        { type: "header", text: { type: "plain_text", text: `📋 購買申請 ${prNumber}` } },
        { type: "section", fields: [
          { type: "mrkdwn", text: `*品目:* ${info.itemName}` },
          { type: "mrkdwn", text: `*金額:* ${info.amount}` },
          { type: "mrkdwn", text: `*申請者:* ${info.applicant}` },
          { type: "mrkdwn", text: `*部門:* ${info.department}` },
        ]},
        { type: "context", elements: [
          { type: "mrkdwn", text: `⛔ ステータス: *取消* （${operatorName} が取消）` },
        ]},
      ];
      text = `取消（${operatorName}・Web経由）`;
      break;
    default:
      return;
  }

  if (!blocks) return;

  try {
    await client.chat.update({
      channel: channelId,
      ts: threadTs,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      blocks: blocks as any,
      text,
    });
    console.log(`[slack-update] ${prNumber} → ${action} (Web: ${operatorName})`);
  } catch (e) {
    console.error(`[slack-update] Failed to update ${prNumber}:`, e);
  }
}
