import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";

const CRON_SECRET = process.env.CRON_SECRET || "";

/**
 * DB接続テスト用エンドポイント
 * GET /api/test/db
 *
 * Supabase Postgres への接続確認 + レイテンシ測定
 * 認証: Bearer CRON_SECRET
 */
export async function GET(request: NextRequest) {
  if (CRON_SECRET) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!process.env.POSTGRES_URL) {
    return NextResponse.json({
      ok: false,
      error: "POSTGRES_URL is not set",
    }, { status: 500 });
  }

  try {
    const start = Date.now();
    // 簡単なクエリでラウンドトリップを測定
    const result = await db.execute(sql`SELECT version() as version, current_database() as database, current_user as user, inet_server_addr() as server_addr`);
    const elapsed = Date.now() - start;

    return NextResponse.json({
      ok: true,
      latencyMs: elapsed,
      result: result[0] ?? null,
      region: extractRegion(process.env.POSTGRES_URL),
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }, { status: 500 });
  }
}

function extractRegion(url: string): string {
  const m = url.match(/@([^.]+)\.pooler\.supabase\.com/) || url.match(/@([^:]+)/);
  if (!m) return "unknown";
  const regionMatch = url.match(/ap-northeast-1|ap-southeast-1|us-east-1|us-west-1|eu-west-1|eu-central-1/);
  return regionMatch ? regionMatch[0] : m[1];
}
