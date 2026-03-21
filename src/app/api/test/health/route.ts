import { NextResponse } from "next/server";

/**
 * ヘルスチェック用エンドポイント
 * GET /api/test/health
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    env: {
      hasSlackToken: !!process.env.SLACK_BOT_TOKEN,
      hasSigningSecret: !!process.env.SLACK_SIGNING_SECRET,
      hasGasUrl: !!process.env.GAS_WEB_APP_URL,
      hasPurchaseChannel: !!process.env.SLACK_PURCHASE_CHANNEL,
      purchaseChannelPrefix: (process.env.SLACK_PURCHASE_CHANNEL || "").substring(0, 3),
    },
  });
}
