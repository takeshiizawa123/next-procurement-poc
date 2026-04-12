import { NextRequest, NextResponse } from "next/server";
import { isRedisAvailable } from "@/lib/shared-cache";
import {
  getEmployees,
  getSuppliers,
  getMastersBundle,
  getRecentRequests,
  getJournalStats,
} from "@/lib/gas-client";

const CRON_SECRET = process.env.CRON_SECRET || "";

/**
 * キャッシュウォーマー — 主要GASデータをRedis/インメモリに先読み
 * GET /api/cron/cache-warm
 *
 * 4分ごとに実行。cachedFetch経由でRedis + インメモリ両方にキャッシュされる。
 * CDNウォーミングも兼ねて自分自身のAPIも叩く。
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const start = Date.now();

  const results: Record<string, { ok: boolean; ms: number }> = {};

  // GAS直接フェッチ（cachedFetch経由 → Redis + インメモリに書き込まれる）
  const tasks: { name: string; fn: () => Promise<unknown> }[] = [
    { name: "employees", fn: () => getEmployees() },
    { name: "suppliers", fn: () => getSuppliers() },
    { name: "mastersBundle", fn: () => getMastersBundle() },
    { name: "recentRequests:30", fn: () => getRecentRequests(undefined, 30) },
    { name: "recentRequests:100", fn: () => getRecentRequests(undefined, 100) },
    { name: "journalStats", fn: () => getJournalStats() },
  ];

  await Promise.all(
    tasks.map(async ({ name, fn }) => {
      const t = Date.now();
      try {
        await fn();
        results[name] = { ok: true, ms: Date.now() - t };
      } catch {
        results[name] = { ok: false, ms: Date.now() - t };
      }
    }),
  );

  // CDNウォーミング（HTTPキャッシュヘッダーを温める）
  const BASE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.NEXT_PUBLIC_APP_URL || "";
  const API_KEY = process.env.NEXT_PUBLIC_INTERNAL_API_KEY || "";

  if (BASE_URL) {
    const cdnEndpoints = [
      "/api/employees",
      "/api/suppliers",
      "/api/mf/masters",
      "/api/purchase/recent?limit=30",
      "/api/admin/approval-routes",
    ];

    await Promise.all(
      cdnEndpoints.map(async (ep) => {
        const t = Date.now();
        try {
          await fetch(`${BASE_URL}${ep}`, {
            headers: { "x-api-key": API_KEY },
            signal: AbortSignal.timeout(30000),
          });
          results[`cdn:${ep}`] = { ok: true, ms: Date.now() - t };
        } catch {
          results[`cdn:${ep}`] = { ok: false, ms: Date.now() - t };
        }
      }),
    );
  }

  console.log("[cache-warm]", JSON.stringify({
    redis: isRedisAvailable(),
    totalMs: Date.now() - start,
    results,
  }));

  return NextResponse.json({ ok: true, redis: isRedisAvailable(), results });
}
