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

// cookie認証日時（30日有効期限の起算用）
let cookieAuthTimestamp: number | null = null;

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

  // cookie有効期限の監視（残り7日で通知）
  checkCookieExpiry().catch(() => {});

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
  // プロセス内の環境変数も更新（同一インスタンスでのloadTokens用）
  process.env.MF_REFRESH_TOKEN = tokens.refresh_token;

  // cookieにもrefresh_tokenを保存（コールドスタート後のブートストラップ用）
  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    cookieStore.set("mf_refresh_token", tokens.refresh_token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60, // 30日
      path: "/api/mf",
    });
    // 認証日時も記録（期限監視用）
    const now = Date.now();
    cookieAuthTimestamp = now;
    cookieStore.set("mf_auth_timestamp", String(now), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60,
      path: "/api/mf",
    });
  } catch {
    // Route Handler外（Slack webhook等）ではcookie設定不可 — インメモリのみ
  }

  console.log("[mf-oauth] Token saved (expires_at:", new Date(tokens.expires_at).toISOString(), ")");
}

async function loadTokens(): Promise<MfTokens | null> {
  if (cachedTokens) return cachedTokens;

  // リフレッシュトークン候補を収集（優先順位順）
  const candidates: string[] = [];

  // 1. process.env（saveTokensで更新された値 or Vercel環境変数）
  if (process.env.MF_REFRESH_TOKEN) {
    candidates.push(process.env.MF_REFRESH_TOKEN);
  }

  // 2. cookieのmf_refresh_token（コールバック時に保存）
  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const cookieToken = cookieStore.get("mf_refresh_token")?.value;
    if (cookieToken && !candidates.includes(cookieToken)) {
      candidates.push(cookieToken);
    }
    // 認証日時を復元（期限監視用）
    const ts = cookieStore.get("mf_auth_timestamp")?.value;
    if (ts && !cookieAuthTimestamp) {
      cookieAuthTimestamp = Number(ts);
    }
  } catch {
    // cookieアクセス不可
  }

  // 各候補を順に試行
  for (const refreshToken of candidates) {
    try {
      console.log("[mf-oauth] Trying refresh token:", refreshToken.substring(0, 8) + "...");
      const tokens = await refreshAccessToken(refreshToken);
      return tokens;
    } catch (e) {
      console.warn("[mf-oauth] Refresh failed for token:", refreshToken.substring(0, 8) + "...", e instanceof Error ? e.message : "");
    }
  }

  if (candidates.length > 0) {
    console.error("[mf-oauth] All refresh token candidates failed");
  }
  return null;
}

/**
 * 認証済みかどうかを確認
 */
export function isAuthenticated(): boolean {
  return cachedTokens !== null || !!process.env.MF_REFRESH_TOKEN;
}

/**
 * 認証状態の詳細情報を返す
 */
export async function getAuthStatus(): Promise<{
  authenticated: boolean;
  accessTokenExpiresAt: string | null;
  cookieAuthAt: string | null;
  cookieExpiresAt: string | null;
  cookieDaysRemaining: number | null;
}> {
  // cookieからtimestampを読み取り
  let authTs = cookieAuthTimestamp;
  if (!authTs) {
    try {
      const { cookies } = await import("next/headers");
      const cookieStore = await cookies();
      const ts = cookieStore.get("mf_auth_timestamp")?.value;
      if (ts) authTs = Number(ts);
    } catch { /* cookie不可 */ }
  }

  const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const cookieExpiresAt = authTs ? authTs + COOKIE_MAX_AGE_MS : null;
  const daysRemaining = cookieExpiresAt
    ? Math.max(0, Math.round((cookieExpiresAt - Date.now()) / (24 * 60 * 60 * 1000)))
    : null;

  return {
    authenticated: isAuthenticated(),
    accessTokenExpiresAt: cachedTokens ? new Date(cachedTokens.expires_at).toISOString() : null,
    cookieAuthAt: authTs ? new Date(authTs).toISOString() : null,
    cookieExpiresAt: cookieExpiresAt ? new Date(cookieExpiresAt).toISOString() : null,
    cookieDaysRemaining: daysRemaining,
  };
}

const COOKIE_WARN_DAYS = 7;

/**
 * cookie有効期限が残り7日以内ならSlack OPSチャネルに通知
 * getValidAccessToken内から呼ばれる（1日1回まで）
 */
let lastExpiryWarning = 0;
async function checkCookieExpiry(): Promise<void> {
  const now = Date.now();
  // 1日に1回だけチェック
  if (now - lastExpiryWarning < 24 * 60 * 60 * 1000) return;

  let authTs = cookieAuthTimestamp;
  if (!authTs) {
    try {
      const { cookies } = await import("next/headers");
      const cookieStore = await cookies();
      const ts = cookieStore.get("mf_auth_timestamp")?.value;
      if (ts) authTs = Number(ts);
    } catch { return; }
  }
  if (!authTs) return;

  const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const expiresAt = authTs + COOKIE_MAX_AGE_MS;
  const daysRemaining = (expiresAt - now) / (24 * 60 * 60 * 1000);

  if (daysRemaining <= COOKIE_WARN_DAYS && daysRemaining > 0) {
    lastExpiryWarning = now;
    const slackToken = process.env.SLACK_BOT_TOKEN;
    const opsChannel = process.env.SLACK_OPS_CHANNEL;
    if (slackToken && opsChannel) {
      fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${slackToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: opsChannel,
          text: `⚠️ *MF会計Plus認証の有効期限が残り${Math.ceil(daysRemaining)}日です*\ncookie有効期限: ${new Date(expiresAt).toLocaleDateString("ja-JP")}\n→ /api/mf/auth?force=true から再認証してください。`,
        }),
      }).catch(() => {});
    }
    console.warn(`[mf-oauth] Cookie expiry warning: ${Math.ceil(daysRemaining)} days remaining`);
  }
}
