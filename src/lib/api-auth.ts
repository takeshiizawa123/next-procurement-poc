/**
 * APIルート認証ヘルパー
 *
 * - サーバ間通信（cron, 内部呼出し）: CRON_SECRET Bearer認証
 * - ブラウザからの呼出し: INTERNAL_API_KEY クエリパラメータ or ヘッダ
 */

import { NextRequest, NextResponse } from "next/server";

const CRON_SECRET = process.env.CRON_SECRET || "";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";

/**
 * サーバ間認証（CRON_SECRET Bearer token）
 * cron, 内部API呼出し, 管理画面用
 */
export function requireBearerAuth(request: NextRequest): NextResponse | null {
  if (!CRON_SECRET) {
    console.error("[auth] CRON_SECRET is not configured — rejecting request");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${CRON_SECRET}`) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * 管理者API認証（ブラウザからの管理操作用）
 * INTERNAL_API_KEYで認証 + SLACK_ADMIN_MEMBERSで管理者チェック
 * cronからのBearer token呼出しも引き続き許可
 */
export function requireAdminAuth(request: NextRequest): NextResponse | null {
  // Bearer token（cron/サーバ間）は従来通り許可
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`) return null;
  // ブラウザからはAPIキー認証
  const apiKeyResult = requireApiKey(request);
  if (apiKeyResult) return apiKeyResult; // 認証失敗
  return null; // 認証成功
}

/**
 * ブラウザ呼出し認証（INTERNAL_API_KEY）
 * ヘッダ x-api-key で受付（クエリパラメータは非推奨）
 */
export function requireApiKey(request: NextRequest): NextResponse | null {
  if (!INTERNAL_API_KEY) {
    // 開発環境（localhost）はスキップ、本番は拒否
    const host = request.headers.get("host") || "";
    if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) return null;
    console.error("[auth] INTERNAL_API_KEY is not configured — rejecting request");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const fromHeader = request.headers.get("x-api-key");
  if (fromHeader === INTERNAL_API_KEY) return null;
  // クエリパラメータは廃止（ログ漏洩リスク）
  const fromQuery = request.nextUrl.searchParams.get("apiKey");
  if (fromQuery === INTERNAL_API_KEY) {
    console.warn("[auth] API key via query parameter is deprecated — use x-api-key header");
    return null; // 移行期間中は許可するが警告
  }
  // Bearer tokenも受け付ける（サーバ間呼出し互換）
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
