/**
 * MF会計Plus OAuth 2.0 認証基盤
 *
 * Authorization Code Grant でトークン取得・リフレッシュ。
 * トークンはファイルベースで永続化（Vercel環境ではKV等に移行予定）。
 */

const MF_CLIENT_ID = process.env.MF_CLIENT_ID || "";
const MF_CLIENT_SECRET = process.env.MF_CLIENT_SECRET || "";
const MF_REDIRECT_URI = process.env.MF_REDIRECT_URI || "";

const AUTH_ENDPOINT = "https://api.biz.moneyforward.com/authorize";
const TOKEN_ENDPOINT = "https://api.biz.moneyforward.com/token";
const SCOPE =
  "mfc/enterprise-accounting/journal.write mfc/enterprise-accounting/journal.read mfc/enterprise-accounting/office.read mfc/enterprise-accounting/master.read";

export interface MfTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp (ms)
  token_type: string;
  scope: string;
}

// インメモリキャッシュ（Vercel serverless では関数インスタンスごとに保持）
let cachedTokens: MfTokens | null = null;

/**
 * OAuth認可URLを生成
 */
export function getAuthorizationUrl(state?: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: MF_CLIENT_ID,
    redirect_uri: MF_REDIRECT_URI,
    scope: SCOPE,
    ...(state ? { state } : {}),
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * 認可コードからトークンを取得
 */
export async function exchangeCodeForTokens(code: string): Promise<MfTokens> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: MF_CLIENT_ID,
      client_secret: MF_CLIENT_SECRET,
      redirect_uri: MF_REDIRECT_URI,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MF token exchange failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const tokens = normalizeTokenResponse(data);
  await saveTokens(tokens);
  console.log("[mf-oauth] Initial auth complete. Update MF_REFRESH_TOKEN env var.");
  return tokens;
}

/**
 * 有効なアクセストークンを取得（期限切れならリフレッシュ）
 */
export async function getValidAccessToken(): Promise<string> {
  let tokens = cachedTokens || (await loadTokens());
  if (!tokens) {
    throw new Error("MF会計Plus未認証。/api/mf/auth にアクセスして認証してください。");
  }

  // 期限の5分前にリフレッシュ
  if (Date.now() > tokens.expires_at - 5 * 60 * 1000) {
    tokens = await refreshAccessToken(tokens.refresh_token);
  }

  return tokens.access_token;
}

/**
 * リフレッシュトークンでアクセストークンを更新
 */
async function refreshAccessToken(refreshToken: string): Promise<MfTokens> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: MF_CLIENT_ID,
      client_secret: MF_CLIENT_SECRET,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const text = await res.text();
    // リフレッシュ失敗 → 再認証が必要
    cachedTokens = null;
    console.error(`[mf-oauth] Token refresh failed (${res.status}): ${text}`);
    // OPSチャネルにアラート（Slack直接呼出しで循環依存を回避）
    const slackToken = process.env.SLACK_BOT_TOKEN;
    const opsChannel = process.env.SLACK_OPS_CHANNEL;
    if (slackToken && opsChannel) {
      fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${slackToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ channel: opsChannel, text: `🚨 *MF会計Plus認証エラー* — トークン更新に失敗しました（${res.status}）。/api/mf/auth から再認証が必要です。` }),
      }).catch(() => {});
    }
    throw new Error(`MF token refresh failed (${res.status}): ${text}。再認証が必要です。`);
  }

  const data = await res.json();
  const tokens = normalizeTokenResponse(data);
  await saveTokens(tokens);
  return tokens;
}

/**
 * 強制リフレッシュ（401エラー時のリトライ用）
 */
export async function forceRefreshToken(): Promise<string> {
  const tokens = cachedTokens || (await loadTokens());
  if (!tokens?.refresh_token) {
    throw new Error("MF会計Plus未認証。再認証が必要です。");
  }
  const refreshed = await refreshAccessToken(tokens.refresh_token);
  return refreshed.access_token;
}

// --- トークン永続化（簡易版: 環境変数 or インメモリ） ---
// 本番ではVercel KV / Upstash Redis等に移行推奨

function normalizeTokenResponse(data: Record<string, unknown>): MfTokens {
  const expiresIn = (data.expires_in as number) || 3600;
  return {
    access_token: data.access_token as string,
    refresh_token: data.refresh_token as string,
    expires_at: Date.now() + expiresIn * 1000,
    token_type: (data.token_type as string) || "Bearer",
    scope: (data.scope as string) || SCOPE,
  };
}

async function saveTokens(tokens: MfTokens): Promise<void> {
  cachedTokens = tokens;
  console.log("[mf-oauth] Token cached in memory (expires_at:", new Date(tokens.expires_at).toISOString(), ")");
  // リフレッシュトークンがローテーションされた場合に警告
  if (process.env.MF_REFRESH_TOKEN && tokens.refresh_token !== process.env.MF_REFRESH_TOKEN) {
    console.warn("[mf-oauth] Refresh token rotated! Update MF_REFRESH_TOKEN env var.");
  }
}

async function loadTokens(): Promise<MfTokens | null> {
  if (cachedTokens) return cachedTokens;

  // コールドスタート: MF_REFRESH_TOKEN 環境変数からブートストラップ
  const envRefreshToken = process.env.MF_REFRESH_TOKEN;
  if (envRefreshToken) {
    console.log("[mf-oauth] Cold start — bootstrapping from MF_REFRESH_TOKEN env var");
    try {
      const tokens = await refreshAccessToken(envRefreshToken);
      return tokens;
    } catch (e) {
      console.error("[mf-oauth] Failed to bootstrap from MF_REFRESH_TOKEN:", e);
      return null;
    }
  }

  return null;
}

/**
 * 認証済みかどうかを確認
 */
export function isAuthenticated(): boolean {
  return cachedTokens !== null || !!process.env.MF_REFRESH_TOKEN;
}
