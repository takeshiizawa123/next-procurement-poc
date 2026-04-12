/**
 * クライアント側API呼び出しヘルパー
 *
 * INTERNAL_API_KEY をヘッダに自動付与する。
 * NEXT_PUBLIC_INTERNAL_API_KEY 環境変数で設定。
 */

const API_KEY = process.env.NEXT_PUBLIC_INTERNAL_API_KEY || "";

/**
 * APIキー付きfetch
 */
export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (API_KEY) {
    headers.set("x-api-key", API_KEY);
  }
  return fetch(url, { ...init, headers });
}

// --- Stale-While-Revalidate クライアントキャッシュ ---

const SWR_PREFIX = "swr:";

interface SwrEntry<T> {
  data: T;
  ts: number; // Date.now()
}

/**
 * localStorageからキャッシュ取得（TTL内ならfresh、超過ならstale）
 */
function swrGet<T>(key: string): { data: T; fresh: boolean; stale: boolean } | null {
  try {
    const raw = localStorage.getItem(SWR_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as SwrEntry<T>;
    if (!entry.data) return null;
    const age = Date.now() - entry.ts;
    // 5分以内: fresh（再フェッチ不要）、5-30分: stale（表示しつつ再フェッチ）、30分超: 期限切れ
    if (age < 5 * 60_000) return { data: entry.data, fresh: true, stale: false };
    if (age < 30 * 60_000) return { data: entry.data, fresh: false, stale: true };
    return null;
  } catch {
    return null;
  }
}

function swrSet<T>(key: string, data: T): void {
  try {
    localStorage.setItem(SWR_PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // localStorage full — ignore
  }
}

/** 特定キーのSWRキャッシュを削除 */
export function swrInvalidate(key: string): void {
  try { localStorage.removeItem(SWR_PREFIX + key); } catch { /* ignore */ }
}

/**
 * Stale-While-Revalidate対応のAPIフェッチ
 *
 * 1. localStorageにキャッシュがあれば即座にonDataを呼ぶ
 * 2. fresh（5分以内）ならそこで終了
 * 3. stale（5-30分）なら表示しつつバックグラウンドで再フェッチ → 完了後に再度onDataを呼ぶ
 * 4. キャッシュなしなら通常フェッチ → onData
 *
 * @returns 初回表示がキャッシュからだったかどうか
 */
export async function apiFetchSWR<T>(
  url: string,
  cacheKey: string,
  onData: (data: T, fromCache: boolean) => void,
  init?: RequestInit,
): Promise<boolean> {
  const cached = swrGet<T>(cacheKey);

  if (cached) {
    onData(cached.data, true);
    if (cached.fresh) return true; // fresh → 再フェッチ不要
  }

  // stale or no cache → フェッチ
  try {
    const res = await apiFetch(url, init);
    if (res.ok) {
      const data = await res.json() as T;
      swrSet(cacheKey, data);
      onData(data, false);
    }
  } catch {
    // ネットワークエラー: キャッシュがあればそれで凌ぐ
  }

  return !!cached;
}
