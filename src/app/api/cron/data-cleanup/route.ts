import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { auditLog, slackEventLog, journalRows } from "@/db/schema";
import { lt, sql } from "drizzle-orm";

const CRON_SECRET = process.env.CRON_SECRET || "";

/**
 * データ保持ポリシーに基づくクリーンアップ
 * GET /api/cron/data-cleanup
 *
 * 保持期間:
 * - audit_log: 2年
 * - slack_event_log: 30日（冪等性チェック用、30日超は不要）
 * - journal_rows: 1年（RAG用、古いデータは精度に寄与しない）
 *
 * 手動実行:
 * curl -H "Authorization: Bearer $CRON_SECRET" https://{url}/api/cron/data-cleanup
 */
export async function GET(request: NextRequest) {
  if (CRON_SECRET) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const results: Record<string, number> = {};

  try {
    // 1. audit_log: 2年以上前を削除
    const auditCutoff = new Date();
    auditCutoff.setFullYear(auditCutoff.getFullYear() - 2);
    const auditDeleted = await db.delete(auditLog).where(lt(auditLog.createdAt, auditCutoff)).returning({ id: auditLog.id });
    results.audit_log = auditDeleted.length;

    // 2. slack_event_log: 30日以上前を削除
    const slackCutoff = new Date();
    slackCutoff.setDate(slackCutoff.getDate() - 30);
    const slackDeleted = await db.delete(slackEventLog).where(lt(slackEventLog.processedAt, slackCutoff)).returning({ eventId: slackEventLog.eventId });
    results.slack_event_log = slackDeleted.length;

    // 3. journal_rows: 1年以上前を削除
    const journalCutoff = new Date();
    journalCutoff.setFullYear(journalCutoff.getFullYear() - 1);
    const journalDeleted = await db.delete(journalRows).where(
      lt(journalRows.importedAt, journalCutoff),
    ).returning({ id: journalRows.id });
    results.journal_rows = journalDeleted.length;

    const totalDeleted = Object.values(results).reduce((a, b) => a + b, 0);
    console.log(`[data-cleanup] Completed: ${JSON.stringify(results)}, total=${totalDeleted}`);

    return NextResponse.json({ ok: true, deleted: results, totalDeleted });
  } catch (error) {
    console.error("[data-cleanup] Error:", error);
    try {
      const { getSlackClient } = await import("@/lib/slack");
      const client = getSlackClient();
      const opsChannel = process.env.SLACK_OPS_CHANNEL;
      if (opsChannel) {
        await client.chat.postMessage({ channel: opsChannel, text: `🚨 *Cron失敗: data-cleanup*\nエラー: ${String(error).slice(0, 300)}` });
      }
    } catch { /* 通知失敗は無視 */ }
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
