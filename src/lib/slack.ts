import { WebClient } from "@slack/web-api";

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
 * 承認ボタン押下時の処理
 */
export const handleApprove: SlackActionHandler = async ({
  client,
  userName,
  channelId,
  messageTs,
  actionValue,
}) => {
  await client.chat.update({
    channel: channelId,
    ts: messageTs,
    blocks: buildApprovedBlocks(actionValue, userName),
    text: `承認済（${userName}）`,
  });
};

/**
 * 差戻しボタン押下時の処理
 */
export const handleReject: SlackActionHandler = async ({
  client,
  userName,
  channelId,
  messageTs,
  actionValue,
}) => {
  await client.chat.update({
    channel: channelId,
    ts: messageTs,
    blocks: buildRejectedBlocks(actionValue, userName),
    text: `差戻し（${userName}）`,
  });
};

/**
 * 発注完了ボタン押下時の処理
 */
export const handleOrderComplete: SlackActionHandler = async ({
  client,
  userName,
  channelId,
  messageTs,
  actionValue,
}) => {
  await client.chat.update({
    channel: channelId,
    ts: messageTs,
    blocks: buildOrderedBlocks(actionValue, userName),
    text: `発注済（${userName}）`,
  });
};

/**
 * 検収完了ボタン押下時の処理
 */
export const handleInspectionComplete: SlackActionHandler = async ({
  client,
  userName,
  channelId,
  messageTs,
  actionValue,
}) => {
  await client.chat.update({
    channel: channelId,
    ts: messageTs,
    blocks: buildInspectedBlocks(actionValue, userName),
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
};

// アクションIDとハンドラーのマッピング
export const actionHandlers: Record<string, SlackActionHandler> = {
  approve_button: handleApprove,
  reject_button: handleReject,
  order_complete_button: handleOrderComplete,
  inspection_complete_button: handleInspectionComplete,
};

// --- スラッシュコマンドハンドラー ---

export async function handlePoTestCommand(
  slackClient: WebClient,
  channelId: string,
  userId: string
): Promise<void> {
  const poNumber = `PO-${new Date().getFullYear()}-TEST`;

  await slackClient.chat.postMessage({
    channel: channelId,
    blocks: buildNewRequestBlocks({
      poNumber,
      itemName: "テスト品目（ノートPC）",
      amount: "¥150,000",
      applicant: `<@${userId}>`,
      department: "テスト部門",
    }),
    text: `購買申請: ${poNumber}`,
  });
}

// --- Block Kit メッセージ構築 ---

interface RequestInfo {
  poNumber: string;
  itemName: string;
  amount: string;
  applicant: string;
  department: string;
}

export function buildNewRequestBlocks(info: RequestInfo) {
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
          value: info.poNumber,
          action_id: "approve_button",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "↩️ 差戻し" },
          style: "danger",
          value: info.poNumber,
          action_id: "reject_button",
        },
      ],
    },
  ];
}

function buildApprovedBlocks(poNumber: string, approver: string) {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: `📋 購買申請 ${poNumber}` },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: "*品目:* テスト品目（ノートPC）" },
        { type: "mrkdwn", text: "*金額:* ¥150,000" },
      ],
    },
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
          value: poNumber,
          action_id: "order_complete_button",
        },
      ],
    },
  ];
}

function buildRejectedBlocks(poNumber: string, rejector: string) {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: `📋 購買申請 ${poNumber}` },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: "*品目:* テスト品目（ノートPC）" },
        { type: "mrkdwn", text: "*金額:* ¥150,000" },
      ],
    },
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

function buildOrderedBlocks(poNumber: string, orderer: string) {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: `📋 購買申請 ${poNumber}` },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: "*品目:* テスト品目（ノートPC）" },
        { type: "mrkdwn", text: "*金額:* ¥150,000" },
      ],
    },
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
          value: poNumber,
          action_id: "inspection_complete_button",
        },
      ],
    },
  ];
}

function buildInspectedBlocks(poNumber: string, inspector: string) {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: `📋 購買申請 ${poNumber}` },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: "*品目:* テスト品目（ノートPC）" },
        { type: "mrkdwn", text: "*金額:* ¥150,000" },
      ],
    },
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
