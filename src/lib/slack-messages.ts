/**
 * Slack Block Kit メッセージビルダー + 通知ヘルパー
 *
 * 各ステータスに対応したメッセージブロックの構築と、
 * OPS通知・承認DM送信を提供する。
 */

import { WebClient } from "@slack/web-api";
import { getPendingVouchers } from "./gas-client";
import { safeDmChannel } from "./slack-client";

// --- 型定義 ---

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
  /** 申請区分: "購入前" | "購入済" | "役務" | "緊急事後報告" */
  requestType?: string;
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
export function buildActionValue(info: RequestInfo): string {
  const rawAmount = info.amount.replace(/[^\d]/g, "") || "0";
  const unitPrice = info.unitPrice ? String(info.unitPrice) : rawAmount;
  return `${info.poNumber}|${info.applicantSlackId}|${info.approverSlackId}|${info.inspectorSlackId}|${rawAmount}|${info.paymentMethod}|${unitPrice}`;
}

// --- ブロックビルダー ---

export function buildNewRequestBlocks(info: RequestInfo) {
  const av = buildActionValue(info);
  const isService = info.requestType === "役務";
  const headerText = isService ? `📋 役務申請 ${info.poNumber}` : `📋 購買申請 ${info.poNumber}`;
  return [
    {
      type: "header",
      text: { type: "plain_text", text: headerText },
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

export function buildApprovedBlocks(
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

export function buildRejectedBlocks(
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

export function buildOrderedBlocks(
  poNumber: string,
  orderer: string,
  actionValue: string,
  info: { itemName: string; amount: string; applicant: string; department: string; supplierName: string; paymentMethod: string } | null,
  isService = false,
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
          text: isService
            ? `🟡 ステータス: *役務開始* （${orderer} が発注）`
            : `🟡 ステータス: *発注済* （${orderer} が発注完了）`,
        },
      ],
    },
    { type: "divider" },
    {
      type: "actions",
      block_id: "inspection_actions",
      elements: isService
        ? [
            {
              type: "button",
              text: { type: "plain_text", text: "✅ 役務完了確認" },
              style: "primary",
              value: actionValue,
              action_id: "inspection_complete_button",
            },
          ]
        : [
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

export function buildInspectedBlocks(
  poNumber: string,
  inspector: string,
  info: { itemName: string; amount: string; applicant: string; department: string; supplierName: string; paymentMethod: string } | null,
  actionValue?: string,
  ecLinked = false,
  isService = false,
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
          text: isService
            ? `🟢 ステータス: *役務完了・請求書待ち* （${inspector} が完了確認）`
            : ecLinked
            ? `🟢 ステータス: *検収済・証憑MF自動取得* （${inspector} が検収）`
            : `🟠 ステータス: *検収済・証憑待ち* （${inspector} が検収）`,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: isService
          ? "📎 *証憑（請求書）をこのスレッドに添付してください*\n⏸️ 請求書が揃うまで経理処理は保留されます"
          : ecLinked
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

export function buildCancelledBlocks(poNumber: string, canceller: string) {
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

export function buildReturnedBlocks(
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
      channel: safeDmChannel(OPS_CHANNEL),
      text,
      ...(blocks ? { blocks } : {}),
    });
  } catch (error) {
    console.error("[ops] Failed to notify:", error);
  }
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
