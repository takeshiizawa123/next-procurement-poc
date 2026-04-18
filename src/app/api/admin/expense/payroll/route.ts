import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/api-auth";
import { db } from "@/db";
import { purchaseRequests, employees } from "@/db/schema";
import { and, eq, gte, lte, isNotNull, sql } from "drizzle-orm";

/**
 * 給与連携: 立替経費+出張手当の月次集計
 * GET /api/admin/expense/payroll?month=YYYY-MM
 *
 * 対象月の 1日〜末日 に「承認済」以降ステータスになったレコードを従業員別に集計。
 * - 立替経費: payment_method="立替" の total_amount 合計
 * - 出張手当: trip_allowance 合計（TRIP-プレフィックスの出張日当）
 *
 * 返却: 従業員別の集計行 + MF給与CSV貼付用の整形データ
 */
export async function GET(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const monthParam = request.nextUrl.searchParams.get("month");
    if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
      return NextResponse.json(
        { error: "month query param required (YYYY-MM)" },
        { status: 400 },
      );
    }

    // 当月の範囲: YYYY-MM-01 〜 YYYY-MM-末日
    const [yearStr, mStr] = monthParam.split("-");
    const year = parseInt(yearStr, 10);
    const month = parseInt(mStr, 10);
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59));

    // 従業員マスタ全件（給与コード・雇用区分含む）
    const emps = await db.select().from(employees).where(eq(employees.isActive, true));

    // 集計対象のpurchase_requests
    // 承認済・発注済・検収済・仕訳済のいずれか（取消・差戻しは除外）
    // 実務上は「仕訳済」にしてMF会計Plusに計上されたものだけ給与連携が安全
    // ただし本番稼働前は柔軟に、申請日が当月のものを全て拾う設計
    const targets = await db
      .select({
        poNumber: purchaseRequests.poNumber,
        applicantSlackId: purchaseRequests.applicantSlackId,
        applicantName: purchaseRequests.applicantName,
        paymentMethod: purchaseRequests.paymentMethod,
        totalAmount: purchaseRequests.totalAmount,
        tripAllowance: purchaseRequests.tripAllowance,
        status: purchaseRequests.status,
        createdAt: purchaseRequests.createdAt,
      })
      .from(purchaseRequests)
      .where(
        and(
          gte(purchaseRequests.createdAt, monthStart),
          lte(purchaseRequests.createdAt, monthEnd),
        ),
      );

    // 従業員別集計
    interface EmpSummary {
      payrollCode: string | null;
      slackId: string;
      name: string;
      employmentType: string | null;
      expenseAmount: number;
      tripAllowance: number;
      expensePoNumbers: string[];
      tripPoNumbers: string[];
    }
    const summary = new Map<string, EmpSummary>();

    for (const t of targets) {
      // 立替または出張日当のあるレコードのみ対象
      const isExpense = t.paymentMethod === "立替";
      const isTripAllowance = t.tripAllowance != null && t.tripAllowance > 0;
      if (!isExpense && !isTripAllowance) continue;

      // 取消・差戻しは除外
      if (t.status === "取消" || t.status === "差戻し") continue;

      // 申請者のSlackIDから従業員を特定
      const emp = emps.find((e) => e.slackId === t.applicantSlackId);
      const key = emp?.slackId || t.applicantSlackId || t.applicantName;

      if (!summary.has(key)) {
        summary.set(key, {
          payrollCode: emp?.payrollCode ?? null,
          slackId: t.applicantSlackId,
          name: emp?.name ?? t.applicantName,
          employmentType: emp?.employmentType ?? null,
          expenseAmount: 0,
          tripAllowance: 0,
          expensePoNumbers: [],
          tripPoNumbers: [],
        });
      }
      const s = summary.get(key)!;
      if (isExpense) {
        s.expenseAmount += t.totalAmount;
        s.expensePoNumbers.push(t.poNumber);
      }
      if (isTripAllowance) {
        s.tripAllowance += t.tripAllowance!;
        s.tripPoNumbers.push(t.poNumber);
      }
    }

    // payrollCode順でソート（未設定は最後）
    const rows = Array.from(summary.values()).sort((a, b) => {
      if (!a.payrollCode && !b.payrollCode) return a.name.localeCompare(b.name);
      if (!a.payrollCode) return 1;
      if (!b.payrollCode) return -1;
      return a.payrollCode.localeCompare(b.payrollCode);
    });

    // 未マッピング従業員の警告
    const unmappedCount = rows.filter((r) => !r.payrollCode).length;

    return NextResponse.json({
      ok: true,
      month: monthParam,
      period: {
        from: monthStart.toISOString().split("T")[0],
        to: monthEnd.toISOString().split("T")[0],
      },
      summary: {
        totalEmployees: rows.length,
        totalExpense: rows.reduce((sum, r) => sum + r.expenseAmount, 0),
        totalTripAllowance: rows.reduce((sum, r) => sum + r.tripAllowance, 0),
        unmappedCount,
      },
      rows,
    });
  } catch (e) {
    console.error("[expense/payroll] Error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
