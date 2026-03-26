import { NextResponse } from "next/server";
import { getAuthorizationUrl, isAuthenticated } from "@/lib/mf-oauth";
import { randomBytes } from "crypto";

/**
 * MF会計Plus OAuth認証開始
 * GET /api/mf/auth → MF認可画面にリダイレクト
 */
export async function GET() {
  if (isAuthenticated()) {
    return NextResponse.json({ ok: true, message: "MF会計Plus認証済み" });
  }

  const state = randomBytes(16).toString("hex");
  const authUrl = getAuthorizationUrl(state);
  return NextResponse.redirect(authUrl);
}
