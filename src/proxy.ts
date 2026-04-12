import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Next.js 16 proxy（旧middleware）
 *
 * Google OAuth設定後に認証を有効化する。
 * 現在はパススルー（AUTH_SECRET未設定時は認証スキップ）。
 */
export async function proxy(request: NextRequest) {
  // AUTH_SECRET未設定 = Google OAuth未設定 → 全リクエスト通過
  if (!process.env.AUTH_SECRET) {
    return NextResponse.next();
  }

  // Google OAuth設定済み → NextAuth認証を適用
  const { auth } = await import("@/auth");
  const session = await auth();
  const { pathname } = request.nextUrl;

  // 認証不要のパス
  // 全APIルートは独自認証(requireApiKey / Slack署名 / Bearer等)を持つため、
  // proxy側ではセッションチェックをスキップ。ページルートのみ保護対象。
  if (
    pathname.startsWith("/api/") ||             // 全APIルート（独自認証あり）
    pathname.startsWith("/auth") ||             // サインインページ
    pathname.startsWith("/_next") ||            // 静的ファイル
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // 未認証 → サインインページへリダイレクト
  if (!session) {
    const signInUrl = new URL("/auth/signin", request.url);
    signInUrl.searchParams.set("callbackUrl", request.url);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
