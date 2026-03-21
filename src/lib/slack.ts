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
  // actionValue: "PO-XXXXXX|applicantSlackId"
  const [poNumber, applicantSlackId] = actionValue.split("|");

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

// アクションIDとハンドラーのマッピング
export const actionHandlers: Record<string, SlackActionHandler> = {
  approve_button: handleApprove,
  reject_button: handleReject,
  order_complete_button: handleOrderComplete,
  inspection_complete_button: handleInspectionComplete,
  cancel_button: handleCancel,
};

// --- /purchase モーダル ---

/**
 * /purchase コマンド → モーダル表示
 */
export async function handlePurchaseCommand(
  slackClient: WebClient,
  triggerId: string,
  channelId: string
): Promise<void> {
  await slackClient.views.open({
    trigger_id: triggerId,
    view: buildPurchaseModal(channelId),
  });
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

  await slackClient.chat.postMessage({
    channel: channelId,
    blocks: buildNewRequestBlocks({
      poNumber,
      itemName: "テスト品目（ノートPC）",
      amount: "¥150,000",
      applicant: `<@${userId}>`,
      department: "テスト部門",
      supplierName: "Amazon",
      paymentMethod: "会社カード",
      applicantSlackId: userId,
    }),
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
        { type: "mrkdwn", text: `*購入先:* ${info.supplierName}` },
        { type: "mrkdwn", text: `*支払:* ${info.paymentMethod}` },
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
        {
          type: "button",
          text: { type: "plain_text", text: "🚫 取消" },
          value: `${info.poNumber}|${info.applicantSlackId}`,
          action_id: "cancel_button",
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
