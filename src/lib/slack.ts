import { WebClient } from "@slack/web-api";
import { updateStatus, getPendingVouchers } from "./gas-client";
import { generatePrediction, isCardPayment } from "./prediction";

/**
 * Slack Web API クライアント
 * Vercel serverless環境ではBoltのReceiverではなく、
 * WebClientを直接使い、ルーティングは自前で行う。
 */

let client: WebClient | null = null;

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
 * 形式: "poNumber|applicantSlackId|approverSlackId|inspectorSlackId|rawAmount|paymentMethod"
 * 後方互換: 旧4フィールド形式もサポート（rawAmount="0", paymentMethod=""にフォールバック）
 */
function parseActionValue(value: string) {
  const [poNumber = "", applicantSlackId = "", approverSlackId = "", inspectorSlackId = "", rawAmount = "0", paymentMethod = ""] = value.split("|");
  return { poNumber, applicantSlackId, approverSlackId, inspectorSlackId, rawAmount, paymentMethod };
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

  // 権限チェック: 指定された承認者のみ
  if (approverSlackId && userId !== approverSlackId) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: "⚠️ この申請の承認権限がありません。承認者として指定された方のみ操作できます。",
    });
    return;
  }

  const message = (body as { message?: { blocks?: Array<{ type: string; fields?: Array<{ text: string }> }> } }).message;
  const info = message?.blocks ? extractRequestInfoFromBlocks(message.blocks) : null;

  await client.chat.update({
    channel: channelId,
    ts: messageTs,
    blocks: buildApprovedBlocks(poNumber, userName, actionValue, info),
    text: `承認済（${userName}）`,
  });

  await notifyOps(client, `✅ *承認完了* ${poNumber}（${userName} が承認）— ${info?.itemName || ""} ${info?.amount || ""}`);

  // GASステータス更新
  updateStatus(poNumber, { "発注承認ステータス": "承認済" }).catch((e) =>
    console.error("[approve] GAS update error:", e)
  );

  // 承認後の通知分岐
  const { applicantSlackId } = parseActionValue(actionValue);
  const amountNum = parseInt((info?.amount || "0").replace(/[^\d]/g, "")) || 0;
  const payMethod = info?.paymentMethod || "";

  // カード払いの場合、予測テーブルに明細を生成（照合用）
  if (isCardPayment(payMethod)) {
    generatePrediction({
      poNumber,
      applicantSlackId,
      applicantName: info?.applicant?.replace(/<@[^>]+>/g, "").trim() || "",
      amount: amountNum,
      supplierName: info?.supplierName || "",
      paymentMethod: payMethod,
    }).catch((e) => console.error("[approve] Prediction error:", e));
  }
  // 購入済（立替）判定: メッセージのヘッダーに「購買報告」があるか
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const headerBlock = (message?.blocks as any[])?.find((b) => b.type === "header");
  const isPurchased = headerBlock?.text?.text?.includes("購買報告") || headerBlock?.text?.text?.includes("購入済") || false;

  if (isPurchased) {
    // 購入済（立替）: 発注・検収不要 → 即「証憑待ち」
    if (applicantSlackId) {
      await client.chat.postMessage({
        channel: applicantSlackId,
        text: `✅ 購入済申請 ${poNumber} が承認されました。証憑（納品書・領収書）がスレッドに添付されていることを確認してください。`,
      });
    }
    // GASも証憑待ち状態に更新
    updateStatus(poNumber, {
      "発注ステータス": "発注済",
      "検収ステータス": "検収済",
    }).catch((e) => console.error("[approve] GAS purchased update error:", e));
  } else {
    // 全件: 申請者が発注（カード/請求書問わず）
    const isInvoice = payMethod === "請求書払い";
    if (applicantSlackId) {
      const orderMsg = isInvoice
        ? `✅ 購買申請 ${poNumber} が承認されました。発注してください。\n届いた請求書は管理本部に提出してください。\n発注後、チャンネルの [発注完了] ボタンを押してください。`
        : `✅ 購買申請 ${poNumber} が承認されました。カードで発注してください。\n発注後、チャンネルの [発注完了] ボタンを押してください。`;
      await client.chat.postMessage({
        channel: applicantSlackId,
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

  // 申請者にDMで差戻し通知
  const { applicantSlackId } = parseActionValue(actionValue);
  if (applicantSlackId) {
    await client.chat.postMessage({
      channel: applicantSlackId,
      text: `↩️ 購買申請 ${poNumber} が差戻しされました（${userName}）。内容を確認のうえ、必要に応じて再申請してください。`,
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

  // 権限チェック: 申請者・承認者・管理本部メンバー
  {
    const allowed = [applicantSlackId, approverSlackId, ...adminMembers].filter(Boolean);
    if (allowed.length > 0 && !allowed.includes(userId)) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: "⚠️ 発注完了の操作権限がありません。",
      });
      return;
    }
  }

  await client.chat.update({
    channel: channelId,
    ts: messageTs,
    blocks: buildOrderedBlocks(poNumber, userName, actionValue, info),
    text: `発注済（${userName}）`,
  });

  await notifyOps(client, `🛒 *発注完了* ${poNumber}（${userName} が発注）— ${info?.itemName || ""} ${info?.amount || ""}`);

  // GASステータス更新
  updateStatus(poNumber, { "発注ステータス": "発注済" }).catch((e) =>
    console.error("[order] GAS update error:", e)
  );

  // 申請者に検収依頼DM
  if (applicantSlackId && applicantSlackId !== userId) {
    await client.chat.postMessage({
      channel: applicantSlackId,
      text: `🛒 ${poNumber} が発注されました（${userName}）。届いたら [検収完了] ボタンを押してください。`,
    });
  }
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
  const { poNumber, applicantSlackId, inspectorSlackId } = parseActionValue(actionValue);

  // 権限チェック: 検収者 or 申請者
  const allowed = [inspectorSlackId, applicantSlackId].filter(Boolean);
  if (allowed.length > 0 && !allowed.includes(userId)) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: "⚠️ 検収完了の操作権限がありません。検収者または申請者のみ操作できます。",
    });
    return;
  }

  const message = (body as { message?: { blocks?: Array<{ type: string; fields?: Array<{ text: string }> }> } }).message;
  const info = message?.blocks ? extractRequestInfoFromBlocks(message.blocks) : null;

  await client.chat.update({
    channel: channelId,
    ts: messageTs,
    blocks: buildInspectedBlocks(poNumber, userName, info),
    text: `検収済（${userName}）`,
  });

  // スレッドに証憑添付依頼を投稿
  await client.chat.postMessage({
    channel: channelId,
    thread_ts: messageTs,
    text: [
      `✅ 検収記録しました（${userName}）`,
      `📎 納品書をこのスレッドに添付してください。`,
      `⏸️ 証憑が添付されるまで、この案件の経理処理は保留されます。`,
    ].join("\n"),
  });

  await notifyOps(client, `📦 *検収完了* ${poNumber}（${userName} が検収）— 証憑待ち`);

  // GASステータス更新
  const today = new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
  updateStatus(poNumber, { "検収ステータス": "検収済", "検収日": today }).catch((e) =>
    console.error("[inspection] GAS update error:", e)
  );
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

  if (approverSlackId && userId !== approverSlackId) {
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

  // 申請者にDMで差戻し通知
  if (applicantSlackId) {
    await client.chat.postMessage({
      channel: applicantSlackId,
      text: `↩️ 購買申請 ${poNumber} が差戻しされました（${userName}）。内容を確認のうえ、必要に応じて再申請してください。`,
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
  actionValue,
}) => {
  const triggerId = (body as { trigger_id?: string }).trigger_id;
  if (!triggerId) {
    console.error("[purchase_open_modal] No trigger_id in payload");
    return;
  }
  const channelId = actionValue; // value にチャンネルIDを入れている
  await client.views.open({
    trigger_id: triggerId,
    view: buildPurchaseModal(channelId),
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
    const res = await fetch(`${baseUrl}/api/mf/journal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prNumber }),
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

// アクションIDとハンドラーのマッピング
export const actionHandlers: Record<string, SlackActionHandler> = {
  approve_button: handleApprove,
  reject_button: handleReject,
  order_complete_button: handleOrderComplete,
  inspection_complete_button: handleInspectionComplete,
  cancel_button: handleCancel,
  dm_approve_button: handleDmApprove,
  dm_reject_button: handleDmReject,
  purchase_open_modal: handleOpenModal,
  journal_register_button: handleJournalRegister,
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
    await slackClient.views.open({
      trigger_id: triggerId,
      view: buildPurchaseModal(channelId),
    });
    return "modal";
  }

  // 2択をエフェメラルメッセージで表示
  const formUrl = `${webFormUrl.startsWith("http") ? webFormUrl : `https://${webFormUrl}`}/purchase/new?user_id=${userId}&channel_id=${channelId}`;

  await slackClient.chat.postEphemeral({
    channel: channelId,
    user: userId,
    text: "購買申請の入力方法を選択してください",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*購買申請* — 入力方法を選んでください",
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
  });
  return "chooser";
}

/**
 * 購買申請モーダル
 */
function buildPurchaseModal(channelId: string) {
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
        },
      },
      // 3. 金額（税込）
      {
        type: "input",
        block_id: "amount",
        label: { type: "plain_text", text: "金額（税込・円）" },
        hint: { type: "plain_text", text: "合計金額（税込）を入力" },
        element: {
          type: "plain_text_input",
          action_id: "amount_input",
          placeholder: { type: "plain_text", text: "例: 165000" },
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
          initial_value: "1",
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
            { text: { type: "plain_text", text: "会社カード" }, value: "会社カード" },
            { text: { type: "plain_text", text: "請求書払い" }, value: "請求書払い" },
            { text: { type: "plain_text", text: "立替" }, value: "立替" },
          ],
        },
      },
      // 6. 購入先名
      {
        type: "input",
        block_id: "supplier_name",
        label: { type: "plain_text", text: "購入先名" },
        hint: { type: "plain_text", text: "Amazonマーケットプレイスの場合は出品者名を記入してください" },
        element: {
          type: "plain_text_input",
          action_id: "supplier_name_input",
          placeholder: { type: "plain_text", text: "例: Amazon、モノタロウ、ASKUL等" },
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
      // 14. 購入理由（任意）
      {
        type: "input",
        block_id: "notes",
        label: { type: "plain_text", text: "購入理由" },
        hint: { type: "plain_text", text: "単価10万円以上、または案件外の購入は必ず記入してください" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "notes_input",
          multiline: true,
          placeholder: { type: "plain_text", text: "購入の目的・理由を記入" },
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
    paymentMethod: "会社カード",
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
 * actionValue 共通形式: "poNumber|applicantSlackId|approverSlackId|inspectorSlackId|rawAmount|paymentMethod"
 */
function buildActionValue(info: RequestInfo): string {
  const rawAmount = info.amount.replace(/[^\d]/g, "") || "0";
  return `${info.poNumber}|${info.applicantSlackId}|${info.approverSlackId}|${info.inspectorSlackId}|${rawAmount}|${info.paymentMethod}`;
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
    channel: info.approverSlackId,
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
          text: { type: "plain_text", text: "✅ 検収完了" },
          style: "primary",
          value: actionValue,
          action_id: "inspection_complete_button",
        },
      ],
    },
  ];
}

function buildInspectedBlocks(
  poNumber: string,
  inspector: string,
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
          text: `🟠 ステータス: *検収済・証憑待ち* （${inspector} が検収）`,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "📎 *納品書をこのスレッドに添付してください*\n⏸️ 証憑が揃うまで経理処理は保留されます",
      },
    },
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
): Promise<void> {
  if (!OPS_CHANNEL) {
    console.warn("[ops] SLACK_OPS_CHANNEL is not set, skipping notification");
    return;
  }
  try {
    await slackClient.chat.postMessage({
      channel: OPS_CHANNEL,
      text,
    });
  } catch (error) {
    console.error("[ops] Failed to notify:", error);
  }
}
