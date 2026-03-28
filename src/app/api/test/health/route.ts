import { NextRequest, NextResponse } from "next/server";

const CRON_SECRET = process.env.CRON_SECRET || "";

/**
 * ヘルスチェック用エンドポイント（認証必須）
 * GET /api/test/health
 */
export async function GET(request: NextRequest) {
  if (CRON_SECRET) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    env: {
      hasSlackToken: !!process.env.SLACK_BOT_TOKEN,
      hasSigningSecret: !!process.env.SLACK_SIGNING_SECRET,
      hasGasUrl: !!process.env.GAS_WEB_APP_URL,
      hasPurchaseChannel: !!process.env.SLACK_PURCHASE_CHANNEL,
      hasDefaultApprover: !!process.env.SLACK_DEFAULT_APPROVER,
      hasAdminMembers: !!process.env.SLACK_ADMIN_MEMBERS,
      hasOpsChannel: !!process.env.SLACK_OPS_CHANNEL,
    },
  });
}
