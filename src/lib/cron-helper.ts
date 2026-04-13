/**
 * Cron Job共通ヘルパー
 * 認証チェックとエラー時OPS通知を統一的に提供
 */

import { NextRequest, NextResponse } from "next/server";

const CRON_SECRET = process.env.CRON_SECRET || "";
const OPS_CHANNEL = process.env.SLACK_OPS_CHANNEL || "";

/**
 * Cronハンドラをラップし、認証チェックとエラー時OPS通知を自動で行う。
 *
 * @param cronName Cron名（例: "daily-summary"）
 * @param handler 実際のCron処理
 */
export function withCronGuard(
  cronName: string,
  handler: (request: NextRequest) => Promise<NextResponse>,
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    // 認証チェック
    if (CRON_SECRET) {
      const authHeader = request.headers.get("authorization");
      if (authHeader !== `Bearer ${CRON_SECRET}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    try {
      return await handler(request);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[cron:${cronName}] Failed:`, errorMessage);

      // OPS通知を試みる
      if (OPS_CHANNEL) {
        try {
          const { getSlackClient } = await import("@/lib/slack");
          const client = getSlackClient();
          await client.chat.postMessage({
            channel: OPS_CHANNEL,
            text: [
              `🚨 *Cron失敗: ${cronName}*`,
              `  エラー: ${errorMessage.slice(0, 300)}`,
              `  時刻: ${new Date().toISOString()}`,
              `  対応: Vercel Dashboard → Cron Jobs で状態を確認`,
            ].join("\n"),
          });
        } catch {
          console.error(`[cron:${cronName}] OPS notification also failed`);
        }
      }

      return NextResponse.json(
        { ok: false, error: errorMessage, cron: cronName },
        { status: 500 },
      );
    }
  };
}
