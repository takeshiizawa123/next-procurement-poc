import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contracts, contractInvoices } from "@/db/schema";
import { eq, and, lte, gte, sql } from "drizzle-orm";
import { getSlackClient, safeDmChannel } from "@/lib/slack";

const CRON_SECRET = process.env.CRON_SECRET || "";
const OPS_CHANNEL = process.env.SLACK_OPS_CHANNEL || "";

/**
 * 契約更新アラート + 請求書未着督促
 * GET /api/cron/contract-alerts
 *
 * Vercel Cron: "0 0 * * *" (UTC 00:00 = JST 09:00, 毎日)
 *
 * 処理:
 * 1. 契約終了日が近い（renewal_alert_days以内）契約を抽出 → 担当者に通知
 * 2. 当月の請求書が未受領のまま15日を超えた契約を抽出 → 督促通知
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const client = getSlackClient();

    // ========================================
    // 1. 契約更新アラート
    // ========================================
    const renewalAlerts: { contractNumber: string; supplierName: string; endDate: string; daysLeft: number; requester: string }[] = [];

    const activeContracts = await db
      .select()
      .from(contracts)
      .where(eq(contracts.isActive, true));

    for (const c of activeContracts) {
      if (!c.contractEndDate) continue; // 無期限はスキップ
      const endDate = new Date(c.contractEndDate);
      const daysLeft = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (daysLeft > 0 && daysLeft <= c.renewalAlertDays) {
        renewalAlerts.push({
          contractNumber: c.contractNumber,
          supplierName: c.supplierName,
          endDate: c.contractEndDate,
          daysLeft,
          requester: c.requesterSlackId || "",
        });

        // 担当者にDM通知
        if (c.requesterSlackId) {
          try {
            await client.chat.postMessage({
              channel: safeDmChannel(c.requesterSlackId),
              text: [
                `⚠️ *契約更新のお知らせ*`,
                `${c.contractNumber} ${c.supplierName}`,
                `契約終了日: ${c.contractEndDate}（あと${daysLeft}日）`,
                `更新タイプ: ${c.renewalType}`,
                "",
                "更新・解約の判断をお願いします",
              ].join("\n"),
            });
          } catch { /* DM失敗は無視 */ }
        }
      }
    }

    // ========================================
    // 2. 請求書未着督促（月の15日以降）
    // ========================================
    const overdueInvoices: { contractNumber: string; supplierName: string; month: string }[] = [];

    if (now.getDate() >= 15) {
      for (const c of activeContracts) {
        if (!c.monthlyAmount) continue;

        const invoices = await db
          .select()
          .from(contractInvoices)
          .where(and(
            eq(contractInvoices.contractId, c.id),
            eq(contractInvoices.billingMonth, currentMonth),
          ))
          .limit(1);

        // 請求書レコードがない、または未受領のまま
        if (invoices.length === 0 || invoices[0].status === "未受領") {
          overdueInvoices.push({
            contractNumber: c.contractNumber,
            supplierName: c.supplierName,
            month: currentMonth,
          });
        }
      }
    }

    // ========================================
    // OPS通知
    // ========================================
    if ((renewalAlerts.length > 0 || overdueInvoices.length > 0) && OPS_CHANNEL) {
      const sections: string[] = [];

      if (renewalAlerts.length > 0) {
        sections.push(
          `⚠️ *契約更新アラート（${renewalAlerts.length}件）*`,
          ...renewalAlerts.map((a) =>
            `  ${a.contractNumber} ${a.supplierName} — 終了: ${a.endDate}（あと${a.daysLeft}日）`
          ),
        );
      }

      if (overdueInvoices.length > 0) {
        sections.push(
          "",
          `📬 *請求書未着（${currentMonth}、${overdueInvoices.length}件）*`,
          ...overdueInvoices.map((o) =>
            `  ${o.contractNumber} ${o.supplierName}`
          ),
          "",
          "取引先に請求書の発行を催促してください",
        );
      }

      await client.chat.postMessage({
        channel: safeDmChannel(OPS_CHANNEL),
        text: sections.join("\n"),
      });
    }

    console.log(`[contract-alerts] renewal=${renewalAlerts.length}, overdue=${overdueInvoices.length}`);

    return NextResponse.json({
      ok: true,
      date: today,
      renewalAlerts: renewalAlerts.length,
      overdueInvoices: overdueInvoices.length,
    });
  } catch (error) {
    console.error("[contract-alerts] Error:", error);
    try {
      const client = getSlackClient();
      if (OPS_CHANNEL) {
        await client.chat.postMessage({
          channel: safeDmChannel(OPS_CHANNEL),
          text: `🚨 *Cron失敗: contract-alerts*\nエラー: ${String(error).slice(0, 300)}`,
        });
      }
    } catch { /* 通知失敗は無視 */ }
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
