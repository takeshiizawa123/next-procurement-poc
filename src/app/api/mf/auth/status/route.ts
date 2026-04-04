import { NextResponse } from "next/server";
import { getAuthStatus } from "@/lib/mf-oauth";

/**
 * MF会計Plus 認証状態確認
 * GET /api/mf/auth/status
 */
export async function GET() {
  try {
    const status = await getAuthStatus();
    return NextResponse.json(status);
  } catch (e) {
    console.error("[mf-auth-status] Error:", e);
    return NextResponse.json({
      authenticated: false,
      accessTokenExpiresAt: null,
      cookieAuthAt: null,
      cookieExpiresAt: null,
      cookieDaysRemaining: null,
    });
  }
}
