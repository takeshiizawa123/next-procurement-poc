/**
 * Upstash Redis 共有キャッシュ + リクエスト合体
 *
 * Vercelインスタンス間でキャッシュを共有し、コールドスタート問題を解消。
 * inflight dedup により同一キーへの同時リクエストを1本にまとめる。
 *
 * フォールバック: UPSTASH_REDIS_REST_URL が未設定の場合はインメモリキャッシュに退化
 */

import { Redis } from "@upstash/redis";

// --- Redis クライアント（環境変数がなければ null） ---
let redis: Redis | null = null;
try {
  // Vercel Storage連携: KV_REST_API_* / 直接Upstash: UPSTASH_REDIS_REST_*
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    redis = new Redis({ url, token });
  }
} catch {
  // 環境変数未設定時はインメモリフォールバック
}

// --- インメモリフォールバック ---
const memCache: Record<string, { data: unknown; expiresAt: number }> = {};

function memGet<T>(key: string): T | null {
  const entry = memCache[key];
  if (!entry || Date.now() > entry.expiresAt) {
    if (entry) delete memCache[key];
    return null;
  }
  return entry.data as T;
}

function memSet(key: string, data: unknown, ttlMs: number): void {
  memCache[key] = { data, expiresAt: Date.now() + ttlMs };
}

function memDelete(key: string): void {
  delete memCache[key];
}

function memDeleteByPrefix(prefix: string): void {
  for (const k of Object.keys(memCache)) {
    if (k.startsWith(prefix)) delete memCache[k];
  }
}

// --- リクエスト合体（inflight dedup） ---
const inflight = new Map<string, Promise<unknown>>();

// --- 公開API ---

const KEY_PREFIX = "gas:";

/**
 * キャッシュから取得（Redis優先、フォールバックでインメモリ）
 */
export async function sharedCacheGet<T>(key: string): Promise<T | null> {
  const fullKey = KEY_PREFIX + key;

  if (redis) {
    try {
      const val = await redis.get<T>(fullKey);
      return val ?? null;
    } catch (e) {
      console.warn("[shared-cache] Redis GET failed, fallback to mem:", e);
    }
  }
  return memGet<T>(fullKey);
}

/**
 * キャッシュに書き込み（Redis + インメモリ両方）
 */
export async function sharedCacheSet<T>(key: string, data: T, ttlMs: number): Promise<void> {
  const fullKey = KEY_PREFIX + key;
  const ttlSec = Math.ceil(ttlMs / 1000);

  // インメモリにも書く（同一インスタンス内のRedisラウンドトリップ節約）
  memSet(fullKey, data, ttlMs);

  if (redis) {
    try {
      await redis.set(fullKey, data, { ex: ttlSec });
    } catch (e) {
      console.warn("[shared-cache] Redis SET failed:", e);
    }
  }
}

/**
 * キャッシュ削除
 */
export async function sharedCacheDelete(key: string): Promise<void> {
  const fullKey = KEY_PREFIX + key;
  memDelete(fullKey);

  if (redis) {
    try {
      await redis.del(fullKey);
    } catch (e) {
      console.warn("[shared-cache] Redis DEL failed:", e);
    }
  }
}

/**
 * プレフィックス一致で削除（invalidateRecentRequests等で使用）
 */
export async function sharedCacheDeleteByPrefix(prefix: string): Promise<void> {
  const fullPrefix = KEY_PREFIX + prefix;
  memDeleteByPrefix(fullPrefix);

  if (redis) {
    try {
      // SCAN + DEL（少量キーなので問題なし）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let scanCursor = 0 as any;
      do {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [nextCursor, keys] = await redis.scan(scanCursor, { match: `${fullPrefix}*`, count: 100 }) as [any, string[]];
        scanCursor = nextCursor;
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } while (Number(scanCursor) !== 0);
    } catch (e) {
      console.warn("[shared-cache] Redis prefix DEL failed:", e);
    }
  }
}

/**
 * キャッシュ付きフェッチ + リクエスト合体
 *
 * 同一キーに対する同時リクエストは1本にまとめ、結果を共有する。
 * キャッシュがあればそれを返し、なければfetcherを実行してキャッシュに保存。
 */
export async function cachedFetch<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  // 1. キャッシュチェック
  const cached = await sharedCacheGet<T>(key);
  if (cached !== null) return cached;

  // 2. inflight dedup — 同じキーのリクエストが進行中なら相乗り
  const fullKey = KEY_PREFIX + key;
  const existing = inflight.get(fullKey);
  if (existing) return existing as Promise<T>;

  // 3. フェッチ実行
  const promise = fetcher().then(async (result) => {
    await sharedCacheSet(key, result, ttlMs);
    return result;
  }).finally(() => {
    inflight.delete(fullKey);
  });

  inflight.set(fullKey, promise);
  return promise;
}

/**
 * Redis接続状態を確認（ヘルスチェック用）
 */
export function isRedisAvailable(): boolean {
  return redis !== null;
}
