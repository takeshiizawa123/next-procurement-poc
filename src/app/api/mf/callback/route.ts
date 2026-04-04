import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { exchangeCodeForTokens } from "@/lib/mf-oauth";
import { timingSafeEqual } from "crypto";

/**
 * MF会計Plus OAuthコールバック
 * GET /api/mf/callback?code=xxx&state=xxx
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const state = request.nextUrl.searchParams.get("state");

  if (error) {
    return NextResponse.json(
      { ok: false, error: `MF認証エラー: ${error}` },
      { status: 400 },
    );
  }

  if (!code) {
    return NextResponse.json(
      { ok: false, error: "認可コードがありません" },
      { status: 400 },
    );
  }

  // CSRF対策: stateパラメータをcookieと照合
  const savedState = request.cookies.get("mf_oauth_state")?.value;
  if (!savedState || !state || savedState.length !== state.length ||
      !timingSafeEqual(Buffer.from(savedState), Buffer.from(state))) {
    console.error("[mf-callback] State mismatch (CSRF protection)");
    return NextResponse.json(
      { ok: false, error: "不正なリクエストです（state不一致）" },
      { status: 403 },
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    console.log("[mf-callback] Token acquired, expires:", new Date(tokens.expires_at).toISOString());

    // 認証成功 → マスタ同期をバックグラウンドで実行後、仕訳管理ページにリダイレクト
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "";
    const baseUrl = appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;

    // バックグラウンドでMFマスタをGASに同期
    after(async () => {
      try {
        const cronSecret = process.env.CRON_SECRET || "";
        await fetch(`${baseUrl}/api/mf/masters/sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
          },
          signal: AbortSignal.timeout(30000),
        });
        console.log("[mf-callback] Master sync triggered");
      } catch (e) {
        console.error("[mf-callback] Master sync failed:", e);
      }
    });

    const response = NextResponse.redirect(`${baseUrl}/admin/journals?mf_auth=ok`);
    response.cookies.delete("mf_oauth_state");
    return response;
  } catch (err) {
    console.error("[mf-callback] Token exchange error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
