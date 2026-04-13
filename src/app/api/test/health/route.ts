import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";

const CRON_SECRET = process.env.CRON_SECRET || "";

/**
 * ヘルスチェック用エンドポイント（認証必須）
 * GET /api/test/health
 *
 * 実際の接続テストを行い、依存サービスの稼働状況を返す。
 */
export async function GET(request: NextRequest) {
  if (CRON_SECRET) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

  // 1. DB接続チェック
  try {
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    checks.database = { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    checks.database = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // 2. Redis接続チェック
  try {
    const start = Date.now();
    const { cachedFetch } = await import("@/lib/shared-cache");
    await cachedFetch("health:ping", 10_000, async () => "pong");
    checks.redis = { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    checks.redis = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // 3. Slack API チェック（軽量: auth.test）
  try {
    const start = Date.now();
    const { getSlackClient } = await import("@/lib/slack");
    const client = getSlackClient();
    const authResult = await client.auth.test();
    checks.slack = { ok: !!authResult.ok, latencyMs: Date.now() - start };
  } catch (e) {
    checks.slack = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // 4. 環境変数チェック
  const envChecks = {
    hasSlackToken: !!process.env.SLACK_BOT_TOKEN,
    hasSigningSecret: !!process.env.SLACK_SIGNING_SECRET,
    hasPurchaseChannel: !!process.env.SLACK_PURCHASE_CHANNEL,
    hasOpsChannel: !!process.env.SLACK_OPS_CHANNEL,
    hasPostgresUrl: !!process.env.POSTGRES_URL,
    hasRedisUrl: !!process.env.KV_REST_API_URL,
    hasCronSecret: !!process.env.CRON_SECRET,
    hasAuthSecret: !!process.env.AUTH_SECRET,
  };

  const allOk = Object.values(checks).every((c) => c.ok);

  return NextResponse.json({
    ok: allOk,
    timestamp: new Date().toISOString(),
    checks,
    env: envChecks,
  }, { status: allOk ? 200 : 503 });
}
