/**
 * Slack クライアント + テストモード安全装置
 *
 * このモジュールはSlack WebClientの初期化、テストモード制御、
 * GASステータス更新のセーフヘルパーを提供する。
 * 他のslack-*.tsモジュールはこのモジュールに依存する。
 */

import { WebClient } from "@slack/web-api";
import { updateStatus } from "./gas-client";

/** 開発者用: 全承認権限を持つSlack ID */
export const DEV_ADMIN_SLACK_ID = "U04FBAX6MEK"; // 伊澤 剛志

/**
 * GAS更新を実行し、失敗時にSlackスレッドに警告を投稿する
 * 成功時は監査ログに変更内容を自動記録する
 */
export async function safeUpdateStatus(
  client: WebClient,
  channelId: string,
  threadTs: string,
  poNumber: string,
  updates: Record<string, string>,
  context: string,
  /** 変更を実行したユーザー（Slack ID or 名前）。auditLog記録用 */
  changedBy?: string,
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

    // 成功時: 監査ログに記録（失敗しても主フローは止めない）
    try {
      const { writeAuditLog } = await import("./db/audit-repo");
      const entries = Object.entries(updates).map(([field, value]) => ({
        tableName: "purchase_requests",
        recordId: poNumber,
        action: "updated",
        ...(changedBy ? { changedBy } : {}),
        fieldName: field,
        newValue: String(value),
        metadata: { context, channelId, threadTs },
      }));
      await writeAuditLog(entries);
    } catch (auditErr) {
      console.warn(`[${context}] audit log write failed:`, auditErr);
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
// テスト専用プライベートチャンネル（自分だけが見える）
const TEST_PRIVATE_CHANNEL = "C0A2HJ6S19P";
// テスト中に許可するユーザー（自分のみ）
const TEST_ALLOWED_USER = "U04FBAX6MEK"; // 伊澤

/**
 * 全Slack送信先を安全なチャンネルにリダイレクトする。
 * テスト環境では:
 * - ユーザーID宛DM: 自分以外は全てテストチャンネルにリダイレクト
 * - 公開チャンネル投稿: 全てテストプライベートチャンネルにリダイレクト
 *
 * ★ この関数を経由しないSlack送信は禁止。
 */
export function safeDmChannel(channel: string): string {
  if (!TEST_MODE) return channel;

  // ユーザーID宛DM（U始まり）
  if (channel.startsWith("U")) {
    // 自分宛のDMはそのまま許可
    if (channel === TEST_ALLOWED_USER) return channel;
    // それ以外は全てテストチャンネルにリダイレクト
    console.log(`[slack] TEST_MODE: redirecting DM ${channel} → ${TEST_PRIVATE_CHANNEL}`);
    return TEST_PRIVATE_CHANNEL;
  }

  // チャンネル投稿（C始まり）— テストプライベートチャンネル以外はリダイレクト
  if (channel.startsWith("C") && channel !== TEST_PRIVATE_CHANNEL) {
    console.log(`[slack] TEST_MODE: redirecting channel ${channel} → ${TEST_PRIVATE_CHANNEL}`);
    return TEST_PRIVATE_CHANNEL;
  }

  return channel;
}

/**
 * Slackクライアントを取得する。
 * TEST_MODE時は chat.postMessage / chat.postEphemeral の channel を自動リダイレクトする。
 */
export function getSlackClient(): WebClient {
  if (client) return client;

  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    throw new Error("SLACK_BOT_TOKEN must be set");
  }

  const rawClient = new WebClient(botToken);

  if (TEST_MODE) {
    // TEST_MODE: 全Slack API呼出しのchannelを自動リダイレクト
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = rawClient.chat as any;
    const origPostMessage = chat.postMessage.bind(chat);
    chat.postMessage = async (args: { channel?: string; [k: string]: unknown }) => {
      if (args.channel) args.channel = safeDmChannel(args.channel);
      return origPostMessage(args);
    };
    const origPostEphemeral = chat.postEphemeral.bind(chat);
    chat.postEphemeral = async (args: { channel?: string; [k: string]: unknown }) => {
      if (args.channel) args.channel = safeDmChannel(args.channel);
      return origPostEphemeral(args);
    };
    const origUpdate = chat.update.bind(chat);
    chat.update = async (args: { channel?: string; [k: string]: unknown }) => {
      if (args.channel) args.channel = safeDmChannel(args.channel);
      return origUpdate(args);
    };
    console.log("[slack] TEST_MODE: client wrapped — all channels auto-redirected to", TEST_PRIVATE_CHANNEL);
  }

  client = rawClient;
  return client;
}

// --- ヘルパー ---

/**
 * payload.message.blocks から申請情報（品目・金額・申請者・部門・購入先・支払）を抽出
 */
export function extractRequestInfoFromBlocks(
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
export function parseActionValue(value: string) {
  const [poNumber = "", applicantSlackId = "", approverSlackId = "", inspectorSlackId = "", rawAmount = "0", paymentMethod = "", unitPrice = ""] = value.split("|");
  return { poNumber, applicantSlackId, approverSlackId, inspectorSlackId, rawAmount, paymentMethod, unitPrice: unitPrice || rawAmount };
}

// --- 型定義 ---

export type SlackActionHandler = (params: {
  client: WebClient;
  body: Record<string, unknown>;
  userId: string;
  userName: string;
  channelId: string;
  messageTs: string;
  actionValue: string;
}) => Promise<void>;
