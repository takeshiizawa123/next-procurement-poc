import { NextRequest, NextResponse } from "next/server";
import { getAuthorizationUrl, isAuthenticated } from "@/lib/mf-oauth";
import { randomBytes } from "crypto";

/**
 * MF会計Plus OAuth認証開始
 * GET /api/mf/auth → MF認可画面にリダイレクト
 * GET /api/mf/auth?force=true → 再認証を強制
 */
export async function GET(request: NextRequest) {
  const force = request.nextUrl.searchParams.get("force") === "true";
  if (!force && isAuthenticated()) {
    return NextResponse.json({ ok: true, message: "MF会計Plus認証済み" });
  }

  const state = randomBytes(16).toString("hex");
  const authUrl = getAuthorizationUrl(state);
  const response = NextResponse.redirect(authUrl);
  response.cookies.set("mf_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600, // 10分
    path: "/api/mf",
  });
  return response;
}
