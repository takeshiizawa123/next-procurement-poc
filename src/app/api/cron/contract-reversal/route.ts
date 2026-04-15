import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contracts, contractInvoices } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSlackClient, safeDmChannel } from "@/lib/slack";

const CRON_SECRET = process.env.CRON_SECRET || "";
const OPS_CHANNEL = process.env.SLACK_OPS_CHANNEL || "";

/**
 * 翌月初リバース（洗替）— 前月の見積計上仕訳を取り消し
 * GET /api/cron/contract-reversal
 *
 * Vercel Cron: "0 16 1 * *" (UTC 16:00 = JST 翌01:00, 毎月1日)
 *
 * 処理:
 * 1. 前月の contract_invoices で status='見積計上' のレコードを取得
 * 2. ステータスを '未受領' にリセット（請求書到着を待つ状態に戻す）
 * 3. OPSに洗替結果を通知
 *
 * NOTE: 実際のMF仕訳のリバース（反対仕訳）はPhase Cで実装。
 * 現段階ではステータス管理のみ。
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    // 前月
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthStr = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;

    // 前月の見積計上レコードを取得
    const accrualInvoices = await db
      .select({
        id: contractInvoices.id,
        contractId: contractInvoices.contractId,
        billingMonth: contractInvoices.billingMonth,
        expectedAmount: contractInvoices.expectedAmount,
      })
      .from(contractInvoices)
      .where(and(
        eq(contractInvoices.billingMonth, prevMonthStr),
        eq(contractInvoices.status, "見積計上"),
      ));

    const reversed: { contractNumber: string; amount: number }[] = [];

    for (const inv of accrualInvoices) {
      // ステータスを '未受領' にリセット
      await db.update(contractInvoices)
        .set({
          status: "未受領",
          updatedAt: new Date(),
        })
        .where(eq(contractInvoices.id, inv.id));

      // 契約番号を取得
      const [contract] = await db
        .select({ contractNumber: contracts.contractNumber })
        .from(contracts)
        .where(eq(contracts.id, inv.contractId))
        .limit(1);

      reversed.push({
        contractNumber: contract?.contractNumber || `contract_id=${inv.contractId}`,
        amount: inv.expectedAmount || 0,
      });
    }

    // OPS通知
    if (reversed.length > 0 && OPS_CHANNEL) {
      const client = getSlackClient();
      const totalAmount = reversed.reduce((sum, r) => sum + r.amount, 0);
      await client.chat.postMessage({
        channel: safeDmChannel(OPS_CHANNEL),
        text: [
          `🔄 *月初洗替（${prevMonthStr}分）*`,
          `${reversed.length}件 の見積計上をリバース（未受領に戻し）`,
          `対象金額: ¥${totalAmount.toLocaleString()}`,
          "",
          "請求書が届いたら契約管理画面で受領・承認してください",
        ].join("\n"),
      });
    }

    console.log(`[contract-reversal] ${prevMonthStr}: reversed=${reversed.length}`);

    return NextResponse.json({
      ok: true,
      month: prevMonthStr,
      reversed: reversed.length,
      details: reversed,
    });
  } catch (error) {
    console.error("[contract-reversal] Error:", error);
    try {
      const client = getSlackClient();
      if (OPS_CHANNEL) {
        await client.chat.postMessage({
          channel: safeDmChannel(OPS_CHANNEL),
          text: `🚨 *Cron失敗: contract-reversal*\nエラー: ${String(error).slice(0, 300)}`,
        });
      }
    } catch { /* 通知失敗は無視 */ }
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
