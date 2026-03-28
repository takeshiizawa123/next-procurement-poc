/**
 * クライアント側API呼び出しヘルパー
 *
 * INTERNAL_API_KEY をヘッダに自動付与する。
 * NEXT_PUBLIC_INTERNAL_API_KEY 環境変数で設定。
 */

const API_KEY = process.env.NEXT_PUBLIC_INTERNAL_API_KEY || "";

/**
 * APIキー付きfetch（GETリクエスト用）
 * クエリパラメータに apiKey を追加
 */
export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (API_KEY) {
    headers.set("x-api-key", API_KEY);
  }
  return fetch(url, { ...init, headers });
}
