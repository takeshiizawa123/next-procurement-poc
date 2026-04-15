import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contracts, contractInvoices } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSlackClient, safeDmChannel } from "@/lib/slack";

const CRON_SECRET = process.env.CRON_SECRET || "";
const OPS_CHANNEL = process.env.SLACK_OPS_CHANNEL || "";

/**
 * 月末見積計上 — 請求書未着の継続契約に未払費用仕訳を自動生成
 * GET /api/cron/contract-accrual
 *
 * Vercel Cron: "0 14 28-31 * *" (UTC 14:00 = JST 23:00, 月末)
 *
 * 処理:
 * 1. is_active=true の契約を全件取得
 * 2. 当月の contract_invoices が未受領 or 存在しない契約を抽出
 * 3. 見積計上レコードを作成（status='見積計上'）
 * 4. OPSに請求書未着一覧を通知
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // アクティブな契約を取得
    const activeContracts = await db
      .select()
      .from(contracts)
      .where(eq(contracts.isActive, true));

    const accrued: { contractNumber: string; supplierName: string; amount: number }[] = [];
    const alreadyProcessed: string[] = [];

    for (const contract of activeContracts) {
      // auto_accrue が false なら見積計上スキップ
      if (!contract.autoAccrue) continue;
      // 月額がない契約はスキップ
      if (!contract.monthlyAmount) continue;

      // 当月の請求書レコードを確認
      const existing = await db
        .select()
        .from(contractInvoices)
        .where(and(
          eq(contractInvoices.contractId, contract.id),
          eq(contractInvoices.billingMonth, currentMonth),
        ))
        .limit(1);

      if (existing.length > 0) {
        const inv = existing[0];
        // 既に承認済み/仕訳済みならスキップ
        if (inv.status === "承認済" || inv.status === "仕訳済" || inv.status === "見積計上") {
          alreadyProcessed.push(contract.contractNumber);
          continue;
        }
      }

      // 見積計上レコードを作成（upsert）
      if (existing.length > 0) {
        await db.update(contractInvoices)
          .set({
            status: "見積計上",
            expectedAmount: contract.monthlyAmount,
            updatedAt: new Date(),
          })
          .where(eq(contractInvoices.id, existing[0].id));
      } else {
        await db.insert(contractInvoices).values({
          contractId: contract.id,
          billingMonth: currentMonth,
          expectedAmount: contract.monthlyAmount,
          status: "見積計上",
        });
      }

      accrued.push({
        contractNumber: contract.contractNumber,
        supplierName: contract.supplierName,
        amount: contract.monthlyAmount,
      });
    }

    // OPS通知
    if (accrued.length > 0 && OPS_CHANNEL) {
      const client = getSlackClient();
      const totalAmount = accrued.reduce((sum, a) => sum + a.amount, 0);
      const lines = accrued.map((a) =>
        `  ${a.contractNumber} ${a.supplierName} ¥${a.amount.toLocaleString()}`
      );
      await client.chat.postMessage({
        channel: safeDmChannel(OPS_CHANNEL),
        text: [
          `📋 *月末見積計上（${currentMonth}）*`,
          `請求書未着の ${accrued.length}件 に未払費用を見積計上しました`,
          `合計: ¥${totalAmount.toLocaleString()}`,
          "",
          ...lines,
          "",
          "請求書が届き次第、契約管理画面で承認してください",
        ].join("\n"),
      });
    }

    console.log(`[contract-accrual] ${currentMonth}: accrued=${accrued.length}, skipped=${alreadyProcessed.length}`);

    return NextResponse.json({
      ok: true,
      month: currentMonth,
      accrued: accrued.length,
      skipped: alreadyProcessed.length,
      details: accrued,
    });
  } catch (error) {
    console.error("[contract-accrual] Error:", error);
    try {
      const client = getSlackClient();
      if (OPS_CHANNEL) {
        await client.chat.postMessage({
          channel: safeDmChannel(OPS_CHANNEL),
          text: `🚨 *Cron失敗: contract-accrual*\nエラー: ${String(error).slice(0, 300)}`,
        });
      }
    } catch { /* 通知失敗は無視 */ }
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
