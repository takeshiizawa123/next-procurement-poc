/**
 * リトライ + Dead Letter Queue (DLQ) ユーティリティ
 *
 * 外部API呼出し（Slack, MF会計Plus, Gemini）の障害耐性を向上させる。
 * - 指数バックオフリトライ（最大3回）
 * - 全リトライ失敗時はDLQテーブルに記録 + OPSチャンネル通知
 */

import { db } from "@/db";
import { deadLetterQueue } from "@/db/schema";

/**
 * 指数バックオフ付きリトライ
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    taskName?: string;
  } = {},
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 200, taskName = "unknown" } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) {
        console.error(`[retry] ${taskName} failed after ${maxRetries + 1} attempts:`, error);
        throw error;
      }
      const delay = baseDelayMs * Math.pow(2, attempt);
      console.warn(`[retry] ${taskName} attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

/**
 * DLQ付きタスク実行
 * リトライ後も失敗した場合、dead_letter_queue テーブルに記録する
 */
export async function executeWithDLQ<T>(
  taskId: string,
  taskType: string,
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    payload?: Record<string, unknown>;
  } = {},
): Promise<T | null> {
  const { maxRetries = 3, payload } = options;

  try {
    return await retryWithBackoff(fn, { maxRetries, taskName: `${taskType}:${taskId}` });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // DLQに記録
    try {
      await db.insert(deadLetterQueue).values({
        taskId,
        taskType,
        errorMessage,
        retryCount: maxRetries + 1,
        payload: payload || null,
      });
      console.error(`[DLQ] Recorded failed task: ${taskType}:${taskId} — ${errorMessage}`);
    } catch (dlqError) {
      console.error(`[DLQ] Failed to record to DLQ:`, dlqError);
    }

    // OPS通知を試みる（失敗しても無視）
    try {
      const { getSlackClient } = await import("@/lib/slack");
      const client = getSlackClient();
      const opsChannel = process.env.SLACK_OPS_CHANNEL;
      if (opsChannel) {
        await client.chat.postMessage({
          channel: opsChannel,
          text: [
            `🚨 *タスク失敗（DLQ記録済み）*`,
            `  タスク: ${taskType}`,
            `  ID: ${taskId}`,
            `  エラー: ${errorMessage.slice(0, 200)}`,
            `  リトライ: ${maxRetries + 1}回試行後に断念`,
          ].join("\n"),
        });
      }
    } catch { /* 通知失敗は無視 */ }

    // Notionにもエラー記録を試みる（失敗しても無視）
    try {
      const { reportError } = await import("@/lib/notion");
      await reportError({
        taskType,
        taskId,
        errorMessage: errorMessage.slice(0, 500),
        severity: "high",
      });
    } catch { /* Notion同期失敗は無視 */ }

    return null;
  }
}
