import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import {
  getSlackClient,
  actionHandlers,
  handlePoTestCommand,
} from "@/lib/slack";

/**
 * Slack Events / Interactive Messages / Slash Commands の統一エンドポイント
 *
 * Slack App設定で以下のURLをすべてこのエンドポイントに向ける:
 *   - Event Subscriptions Request URL
 *   - Interactivity & Shortcuts Request URL
 *   - Slash Commands Request URL
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  const timestamp = request.headers.get("x-slack-request-timestamp") || "";
  const slackSignature = request.headers.get("x-slack-signature") || "";

  // 署名検証
  if (!verifySlackSignature(body, timestamp, slackSignature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  // Content-Type に応じてペイロードをパース
  const contentType = request.headers.get("content-type") || "";
  let payload: Record<string, unknown>;

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(body);
    if (params.has("payload")) {
      // Interactive Messages（ボタンクリック等）
      payload = JSON.parse(params.get("payload")!);
    } else {
      // Slash Commands
      payload = Object.fromEntries(params.entries());
    }
  } else {
    // Events API (JSON)
    payload = JSON.parse(body);
  }

  // URL Verification（Slack App初回設定時のチャレンジ）
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  // 非同期処理（Slackには即座に200を返す）
  try {
    if (payload.type === "block_actions") {
      await handleBlockActions(payload);
    } else if (typeof payload.command === "string") {
      await handleSlashCommand(payload);
    }
    // event_callback は将来的に追加
  } catch (error) {
    console.error("Slack event processing error:", error);
  }

  return NextResponse.json({ ok: true });
}

// --- 署名検証 ---

function verifySlackSignature(
  body: string,
  timestamp: string,
  signature: string
): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET || "";

  // 開発時はスキップ可能（本番では必須）
  if (!signingSecret) {
    console.warn("SLACK_SIGNING_SECRET not set. Skipping verification.");
    return true;
  }

  if (!timestamp || !signature) return false;

  // リプレイ攻撃防止（5分）
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) return false;

  const sigBaseString = `v0:${timestamp}:${body}`;
  const mySignature =
    "v0=" +
    crypto
      .createHmac("sha256", signingSecret)
      .update(sigBaseString)
      .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(mySignature),
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}

// --- Interactive Messages ハンドラー ---

async function handleBlockActions(
  payload: Record<string, unknown>
): Promise<void> {
  const client = getSlackClient();

  const user = payload.user as { id: string; name?: string; username?: string };
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

// --- Slash Commands ハンドラー ---

async function handleSlashCommand(
  payload: Record<string, unknown>
): Promise<void> {
  const command = payload.command as string;
  const channelId = payload.channel_id as string;
  const userId = payload.user_id as string;

  const client = getSlackClient();

  switch (command) {
    case "/po-test":
      await handlePoTestCommand(client, channelId, userId);
      break;
    default:
      console.warn(`Unknown command: ${command}`);
  }
}
