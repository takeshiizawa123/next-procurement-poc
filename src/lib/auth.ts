import { auth } from "@/auth";

/**
 * サーバーサイドでセッションを取得するヘルパー
 * Server ComponentやAPI Routeで使用
 */
export async function getSession() {
  return auth();
}

/**
 * セッションからメールアドレスを取得
 */
export async function getSessionEmail(): Promise<string | null> {
  const session = await auth();
  return session?.user?.email ?? null;
}
