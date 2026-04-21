import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contracts } from "@/db/schema";
import { and, eq, or, isNull, gte } from "drizzle-orm";
import { requireAdminAuth } from "@/lib/api-auth";
import {
  scheduledPaymentDate,
  resolvedPaymentDate,
  formatDateJST,
  daysDiff,
} from "@/lib/business-day";

/**
 * 支払スケジュール API
 * GET /api/admin/payments/schedule?from=YYYY-MM&to=YYYY-MM
 *
 * 指定期間内の有効契約の支払予定を日付順に列挙。
 * 休日繰延ロジック適用済。
 */

interface ScheduleItem {
  contractId: number;
  contractNumber: string;
  supplierName: string;
  category: string;
  scheduledDate: string; // 約定日 YYYY-MM-DD
  resolvedDate: string; // 実支払日 (休日繰延後)
  shifted: boolean; // 繰延あり
  amount: number;
  paymentMethod: string | null;
  accountTitle: string;
  billingType: string;
}

export async function GET(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const fromParam = request.nextUrl.searchParams.get("from");
    const toParam = request.nextUrl.searchParams.get("to");

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const from = fromParam
      ? new Date(`${fromParam}-01`)
      : new Date(today.getFullYear(), today.getMonth(), 1);
    const to = toParam
      ? new Date(new Date(`${toParam}-01`).setMonth(new Date(`${toParam}-01`).getMonth() + 1, 0))
      : new Date(today.getFullYear(), today.getMonth() + 3, 0);

    // 有効契約（期間内でアクティブ）
    const active = await db
      .select()
      .from(contracts)
      .where(
        and(
          eq(contracts.isActive, true),
          or(
            isNull(contracts.contractEndDate),
            gte(contracts.contractEndDate, formatDateJST(from)),
          ),
        ),
      );

    const items: ScheduleItem[] = [];

    // 期間内の各月を列挙
    const months: Array<{ year: number; month: number }> = [];
    const cur = new Date(from.getFullYear(), from.getMonth(), 1);
    while (cur <= to) {
      months.push({ year: cur.getFullYear(), month: cur.getMonth() + 1 });
      cur.setMonth(cur.getMonth() + 1);
    }

    for (const contract of active) {
      if (!contract.paymentDay || !contract.monthlyAmount) continue;

      for (const { year, month } of months) {
        const scheduled = scheduledPaymentDate(contract.paymentDay, year, month);
        const resolved = resolvedPaymentDate(contract.paymentDay, year, month);

        // 期間外
        if (resolved < from || resolved > to) continue;

        // 契約終了日を超えたものは除外
        if (contract.contractEndDate) {
          const end = new Date(contract.contractEndDate);
          if (resolved > end) continue;
        }

        // 契約開始前は除外
        const start = new Date(contract.contractStartDate);
        if (resolved < start) continue;

        items.push({
          contractId: contract.id,
          contractNumber: contract.contractNumber,
          supplierName: contract.supplierName,
          category: contract.category,
          scheduledDate: formatDateJST(scheduled),
          resolvedDate: formatDateJST(resolved),
          shifted: daysDiff(scheduled, resolved) > 0,
          amount: contract.monthlyAmount,
          paymentMethod: contract.paymentMethod,
          accountTitle: contract.accountTitle,
          billingType: contract.billingType,
        });
      }
    }

    items.sort((a, b) => a.resolvedDate.localeCompare(b.resolvedDate));

    // 集計
    const totalAmount = items.reduce((s, i) => s + i.amount, 0);
    const byMethod: Record<string, { count: number; total: number }> = {};
    for (const i of items) {
      const m = i.paymentMethod || "未設定";
      if (!byMethod[m]) byMethod[m] = { count: 0, total: 0 };
      byMethod[m].count++;
      byMethod[m].total += i.amount;
    }

    return NextResponse.json({
      ok: true,
      period: { from: formatDateJST(from), to: formatDateJST(to) },
      count: items.length,
      totalAmount,
      byMethod,
      items,
    });
  } catch (e) {
    console.error("[payments/schedule] Error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
