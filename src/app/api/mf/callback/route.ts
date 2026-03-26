import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/mf-oauth";

/**
 * MF会計Plus OAuthコールバック
 * GET /api/mf/callback?code=xxx&state=xxx
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

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

  try {
    const tokens = await exchangeCodeForTokens(code);
    console.log("[mf-callback] Token acquired, expires:", new Date(tokens.expires_at).toISOString());

    return NextResponse.json({
      ok: true,
      message: "MF会計Plus認証完了。仕訳登録が利用可能です。",
      expires_at: new Date(tokens.expires_at).toISOString(),
    });
  } catch (err) {
    console.error("[mf-callback] Token exchange error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
