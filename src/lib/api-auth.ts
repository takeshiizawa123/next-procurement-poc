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
  if (!CRON_SECRET) return null; // 未設定時はスキップ（開発環境）
  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${CRON_SECRET}`) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * ブラウザ呼出し認証（INTERNAL_API_KEY）
 * クエリパラメータ ?apiKey=xxx またはヘッダ x-api-key で受付
 */
export function requireApiKey(request: NextRequest): NextResponse | null {
  if (!INTERNAL_API_KEY) return null; // 未設定時はスキップ（開発環境）
  const fromQuery = request.nextUrl.searchParams.get("apiKey");
  const fromHeader = request.headers.get("x-api-key");
  if (fromQuery === INTERNAL_API_KEY || fromHeader === INTERNAL_API_KEY) return null;
  // Bearer tokenも受け付ける（サーバ間呼出し互換）
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
