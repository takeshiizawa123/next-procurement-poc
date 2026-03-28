import { NextRequest, NextResponse } from "next/server";
import { getRecentRequests } from "@/lib/gas-client";
import type { PastRequest } from "@/lib/gas-client";

/**
 * 従業員別利用傾向API
 * GET /api/admin/spending?months=3
 *
 * 購買台帳から従業員別・月別の利用金額を集計して返す。
 */
export async function GET(request: NextRequest) {
  const monthsParam = request.nextUrl.searchParams.get("months");
  const monthsBack = Math.min(Math.max(parseInt(monthsParam || "3", 10), 1), 12);

  try {
    const result = await getRecentRequests(undefined, 500);
    const requests = result.success ? (result.data?.requests || []) : [];

    if (requests.length === 0) {
      return NextResponse.json({ ok: true, employees: [], months: [], summary: {} });
    }

    // 対象月の範囲を計算
    const now = new Date();
    const targetMonths: string[] = [];
    for (let i = 0; i < monthsBack; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      targetMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }

    // 対象期間内の申請をフィルタ
    const filtered = requests.filter((r) => {
      const m = r.applicationDate?.match(/(\d{4})-(\d{2})/);
      return m ? targetMonths.includes(`${m[1]}-${m[2]}`) : false;
    });

    // 従業員別集計
    const empMap = new Map<string, {
      name: string;
      department: string;
      totalAmount: number;
      count: number;
      byMonth: Record<string, { amount: number; count: number }>;
      byCategory: Record<string, { amount: number; count: number }>;
      byPayment: Record<string, { amount: number; count: number }>;
      requests: Array<{ prNumber: string; date: string; item: string; amount: number; supplier: string; payment: string }>;
    }>();

    for (const r of filtered) {
      const key = r.applicant;
      if (!empMap.has(key)) {
        empMap.set(key, {
          name: key,
          department: r.department || "",
          totalAmount: 0,
          count: 0,
          byMonth: {},
          byCategory: {},
          byPayment: {},
          requests: [],
        });
      }
      const emp = empMap.get(key)!;
      const amount = r.totalAmount || 0;
      emp.totalAmount += amount;
      emp.count++;

      // 月別
      const monthKey = extractMonth(r.applicationDate);
      if (!emp.byMonth[monthKey]) emp.byMonth[monthKey] = { amount: 0, count: 0 };
      emp.byMonth[monthKey].amount += amount;
      emp.byMonth[monthKey].count++;

      // 勘定科目別
      const cat = r.accountTitle || "未分類";
      if (!emp.byCategory[cat]) emp.byCategory[cat] = { amount: 0, count: 0 };
      emp.byCategory[cat].amount += amount;
      emp.byCategory[cat].count++;

      // 支払方法別
      const pay = r.paymentMethod || "不明";
      if (!emp.byPayment[pay]) emp.byPayment[pay] = { amount: 0, count: 0 };
      emp.byPayment[pay].amount += amount;
      emp.byPayment[pay].count++;

      // 明細（直近20件まで）
      if (emp.requests.length < 20) {
        emp.requests.push({
          prNumber: r.prNumber,
          date: r.applicationDate,
          item: r.itemName,
          amount,
          supplier: r.supplierName,
          payment: r.paymentMethod,
        });
      }
    }

    // 金額降順でソート
    const employees = Array.from(empMap.values()).sort((a, b) => b.totalAmount - a.totalAmount);

    // 全体サマリ
    const totalAmount = employees.reduce((s, e) => s + e.totalAmount, 0);
    const totalCount = employees.reduce((s, e) => s + e.count, 0);
    const avgPerEmployee = employees.length > 0 ? Math.round(totalAmount / employees.length) : 0;

    // 部門別集計
    const deptMap = new Map<string, { amount: number; count: number }>();
    for (const emp of employees) {
      const dept = emp.department || "未所属";
      if (!deptMap.has(dept)) deptMap.set(dept, { amount: 0, count: 0 });
      deptMap.get(dept)!.amount += emp.totalAmount;
      deptMap.get(dept)!.count += emp.count;
    }

    return NextResponse.json({
      ok: true,
      months: targetMonths,
      employees,
      summary: {
        totalAmount,
        totalCount,
        avgPerEmployee,
        employeeCount: employees.length,
        byDepartment: Object.fromEntries(deptMap),
      },
    });
  } catch (error) {
    console.error("[spending] Error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

function extractMonth(dateStr: string): string {
  const m = dateStr?.match(/(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : "unknown";
}
