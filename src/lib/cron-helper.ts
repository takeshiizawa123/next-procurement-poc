/**
 * Cron Job共通ヘルパー
 * 認証チェックとエラー時OPS通知を統一的に提供
 */

import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

const CRON_SECRET = process.env.CRON_SECRET || "";
const OPS_CHANNEL = process.env.SLACK_OPS_CHANNEL || "";

// Redis（排他ロック用）
let redis: Redis | null = null;
try {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    redis = new Redis({ url, token });
  }
} catch {
  // Redis未設定時はロックなし（Vercel cronは通常単発実行なのでベストエフォート）
}

/**
 * Redis排他ロックでCron実行を直列化する
 * 複数インスタンスの同時実行を防ぐ（Vercel retry等）
 *
 * @param lockKey ユニークなロックキー（cron名と同じでOK）
 * @param ttlSec ロックのTTL秒（cron実行時間より少し長めに）
 * @param fn 実行する関数
 * @returns 実行結果 または undefined（ロック取得失敗時）
 */
export async function withCronLock<T>(
  lockKey: string,
  ttlSec: number,
  fn: () => Promise<T>,
): Promise<T | { skipped: true; reason: string }> {
  if (!redis) {
    // Redis未設定 → ロックなしで実行（Vercel cronは通常単発なのでベストエフォート）
    return await fn();
  }

  const fullKey = `cron:lock:${lockKey}`;
  try {
    // SET NX EX: 既存ロックがあればfalse
    const result = await redis.set(fullKey, Date.now().toString(), {
      nx: true,
      ex: ttlSec,
    });
    if (result !== "OK") {
      console.warn(`[cron:${lockKey}] Lock already held, skipping execution`);
      return { skipped: true, reason: "lock already held (concurrent run prevented)" };
    }
  } catch (e) {
    console.warn(`[cron:${lockKey}] Redis lock failed, proceeding without lock:`, e);
    return await fn();
  }

  try {
    return await fn();
  } finally {
    try {
      await redis.del(fullKey);
    } catch {
      // ロック解放失敗はTTLで自動解放されるのでOK
    }
  }
}

/**
 * Cronハンドラをラップし、認証チェックとエラー時OPS通知を自動で行う。
 *
 * @param cronName Cron名（例: "daily-summary"）
 * @param handler 実際のCron処理
 */
export function withCronGuard(
  cronName: string,
  handler: (request: NextRequest) => Promise<NextResponse>,
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    // 認証チェック
    if (CRON_SECRET) {
      const authHeader = request.headers.get("authorization");
      if (authHeader !== `Bearer ${CRON_SECRET}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    try {
      return await handler(request);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[cron:${cronName}] Failed:`, errorMessage);

      // OPS通知を試みる
      if (OPS_CHANNEL) {
        try {
          const { getSlackClient } = await import("@/lib/slack");
          const client = getSlackClient();
          await client.chat.postMessage({
            channel: OPS_CHANNEL,
            text: [
              `🚨 *Cron失敗: ${cronName}*`,
              `  エラー: ${errorMessage.slice(0, 300)}`,
              `  時刻: ${new Date().toISOString()}`,
              `  対応: Vercel Dashboard → Cron Jobs で状態を確認`,
            ].join("\n"),
          });
        } catch {
          console.error(`[cron:${cronName}] OPS notification also failed`);
        }
      }

      return NextResponse.json(
        { ok: false, error: errorMessage, cron: cronName },
        { status: 500 },
      );
    }
  };
}
