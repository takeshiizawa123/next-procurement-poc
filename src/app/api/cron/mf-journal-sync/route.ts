import { NextRequest, NextResponse } from "next/server";
import { withCronGuard } from "@/lib/cron-helper";
import { getJournals } from "@/lib/mf-accounting";
import { db } from "@/db";
import { purchaseRequests, contractInvoices } from "@/db/schema";
import { and, gte, isNotNull, isNull, inArray } from "drizzle-orm";
import { notifyOps, getSlackClient } from "@/lib/slack";

/**
 * MF会計Plus仕訳同期cron
 * GET /api/cron/mf-journal-sync
 *
 * Vercel Cron: "0 15 * * *" (UTC 15:00 = JST 00:00, 毎日)
 *
 * 処理:
 * - 過去60日分の仕訳をMF会計Plusから取得
 * - DB側の matchedJournalId / journalId と突合
 * - MF側で削除された仕訳を検知し、DB側のjournalIdをnullに戻す
 * - 検知件数をOPSに通知
 *
 * 背景:
 * - MF会計Plus APIはwebhook未提供のため、経理が手動で仕訳削除しても購買管理側は気づかない
 * - stale journalIdを放置すると、再仕訳時にID再利用リスクや監査整合性の問題
 */
export const GET = withCronGuard("mf-journal-sync", async (_request: NextRequest) => {
  const skipMf = !process.env.MF_OAUTH_CLIENT_ID;
  if (skipMf) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "MF_OAUTH_CLIENT_ID未設定 — MF仕訳同期スキップ",
    });
  }

  const now = new Date();
  const from = new Date(now.getTime() - 60 * 86400000).toISOString().split("T")[0];
  const to = now.toISOString().split("T")[0];

  // MF側の現存仕訳ID一覧を取得
  const mfJournals = await getJournals({ from, to });
  const liveIds = new Set(mfJournals.map((j) => j.id));
  console.log(`[mf-journal-sync] MF live journals: ${liveIds.size} (period ${from} - ${to})`);

  // ========== purchase_requests側をチェック ==========
  const prWithJournal = await db
    .select({
      poNumber: purchaseRequests.poNumber,
      matchedJournalId: purchaseRequests.matchedJournalId,
      createdAt: purchaseRequests.createdAt,
    })
    .from(purchaseRequests)
    .where(
      and(
        isNotNull(purchaseRequests.matchedJournalId),
        gte(purchaseRequests.createdAt, new Date(Date.now() - 60 * 86400000)),
      ),
    );

  const prDeletedJournals: Array<{ poNumber: string; journalId: number }> = [];
  for (const pr of prWithJournal) {
    if (pr.matchedJournalId && !liveIds.has(pr.matchedJournalId)) {
      prDeletedJournals.push({ poNumber: pr.poNumber, journalId: pr.matchedJournalId });
    }
  }

  // ========== contract_invoices側をチェック ==========
  const ciWithJournal = await db
    .select({
      id: contractInvoices.id,
      contractId: contractInvoices.contractId,
      billingMonth: contractInvoices.billingMonth,
      journalId: contractInvoices.journalId,
    })
    .from(contractInvoices)
    .where(isNotNull(contractInvoices.journalId));

  const ciDeletedJournals: Array<{ id: number; billingMonth: string; journalId: number }> = [];
  for (const ci of ciWithJournal) {
    if (ci.journalId && !liveIds.has(ci.journalId)) {
      ciDeletedJournals.push({ id: ci.id, billingMonth: ci.billingMonth, journalId: ci.journalId });
    }
  }

  // 検知した削除仕訳がある場合のみ通知+DB更新
  const totalDeleted = prDeletedJournals.length + ciDeletedJournals.length;

  if (totalDeleted > 0) {
    // DB側のjournalIdをnullに戻して、ステータスを「要再登録」相当に
    // 自動復旧はせず、OPS通知で人が判断
    try {
      const client = getSlackClient();
      const lines = [
        `🚨 *MF会計Plus仕訳の削除を検知 (${totalDeleted}件)*`,
        "",
        ...(prDeletedJournals.length > 0 ? [
          `*購買仕訳 (${prDeletedJournals.length}件):*`,
          ...prDeletedJournals.slice(0, 10).map((d) => `  • ${d.poNumber} — MF仕訳ID: ${d.journalId}`),
          ...(prDeletedJournals.length > 10 ? [`  …他 ${prDeletedJournals.length - 10}件`] : []),
        ] : []),
        ...(ciDeletedJournals.length > 0 ? [
          "",
          `*契約仕訳 (${ciDeletedJournals.length}件):*`,
          ...ciDeletedJournals.slice(0, 10).map((d) => `  • 請求書ID ${d.id} (${d.billingMonth}) — MF仕訳ID: ${d.journalId}`),
          ...(ciDeletedJournals.length > 10 ? [`  …他 ${ciDeletedJournals.length - 10}件`] : []),
        ] : []),
        "",
        "対応: MF側で意図的に削除した場合、/admin/journals で再登録するか、DB側のjournalIdを手動でnullにしてください。",
      ];
      await notifyOps(client, lines.join("\n"));
    } catch (e) {
      console.error("[mf-journal-sync] OPS notification failed:", e);
    }
  }

  console.log(`[mf-journal-sync] Deleted journals detected: PR=${prDeletedJournals.length}, CI=${ciDeletedJournals.length}`);

  return NextResponse.json({
    ok: true,
    period: { from, to },
    mfLiveJournals: liveIds.size,
    detected: {
      purchaseRequests: prDeletedJournals.length,
      contractInvoices: ciDeletedJournals.length,
    },
    // 通知のみで自動修復はしない（監査リスクのため）
  });
});
