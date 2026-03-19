import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import {
  getSlackClient,
  actionHandlers,
  handlePoTestCommand,
} from "@/lib/slack";

// Vercel Serverless の最大実行時間
export const maxDuration = 10;

/**
 * Slack Events / Interactive Messages / Slash Commands の統一エンドポイント
 *
 * 重要: Slackは3秒以内のレスポンスを要求する。
 * 処理を fire-and-forget で起動し、即座に200を返す。
 */
export async function POST(request: NextRequest) {
  console.log("[slack] POST received", {
    url: request.url,
    contentType: request.headers.get("content-type"),
  });

  const body = await request.text();
  const timestamp = request.headers.get("x-slack-request-timestamp") || "";
  const slackSignature = request.headers.get("x-slack-signature") || "";

  // 署名検証（POCデバッグ中: 一時無効化）
  // TODO: 本番では必ず有効化すること
  console.log("[slack] signature check skipped for debugging");
  console.log("[slack] headers:", { timestamp, hasSignature: !!slackSignature });

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

  console.log("[slack] payload type:", payload.type || payload.command || "unknown");

  // URL Verification
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  // fire-and-forget: awaitせずに処理を開始し、即座にレスポンスを返す
  // .catch() でエラーを握りつぶす（レスポンスはすでに返却済み）
  if (payload.type === "block_actions") {
    handleBlockActions(payload).catch((e) =>
      console.error("[slack] block_actions error:", e)
    );
  } else if (typeof payload.command === "string") {
    handleSlashCommand(payload).catch((e) =>
      console.error("[slack] slash command error:", e)
    );
  }

  // 即座に200を返す
  return new NextResponse("", { status: 200 });
}

// --- 署名検証 ---

function verifySlackSignature(
  body: string,
  timestamp: string,
  signature: string
): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET || "";

  if (!signingSecret) {
    console.warn("SLACK_SIGNING_SECRET not set. Skipping verification.");
    return true;
  }

  if (!timestamp || !signature) return false;

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
