import { NextRequest, NextResponse } from "next/server";
import { getEmployees, updateApprover } from "@/lib/gas-client";
import { requireApiKey } from "@/lib/api-auth";

/**
 * 承認ルート設定API
 *
 * GET  /api/admin/approval-routes — 部門別承認者一覧
 * POST /api/admin/approval-routes — 承認者を更新
 */
export async function GET(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  try {
    const result = await getEmployees();
    if (!result.success || !result.data?.employees) {
      return NextResponse.json({ error: "従業員マスタの取得に失敗しました" }, { status: 500 });
    }

    // 部門ごとにグループ化し、承認者情報を整理
    const deptMap: Record<string, {
      departmentName: string;
      departmentCode: string;
      approverSlackId: string;
      approverName: string;
      members: { name: string; slackId: string }[];
    }> = {};

    for (const emp of result.data.employees) {
      const dept = emp.departmentName || "未所属";
      if (!deptMap[dept]) {
        deptMap[dept] = {
          departmentName: dept,
          departmentCode: emp.departmentCode || "",
          approverSlackId: emp.deptHeadSlackId || "",
          approverName: "",
          members: [],
        };
      }
      deptMap[dept].members.push({ name: emp.name, slackId: emp.slackId || "" });

      // 承認者名を解決
      if (emp.deptHeadSlackId && !deptMap[dept].approverName) {
        const approver = result.data.employees.find((e) => e.slackId === emp.deptHeadSlackId);
        if (approver) deptMap[dept].approverName = approver.name;
      }
    }

    const departments = Object.values(deptMap).sort((a, b) => a.departmentName.localeCompare(b.departmentName));

    // 承認者候補（全従業員リスト）
    const allEmployees = result.data.employees.map((e) => ({
      name: e.name,
      slackId: e.slackId || "",
      departmentName: e.departmentName || "",
    }));

    const res = NextResponse.json({ departments, allEmployees });
    res.headers.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  let body: { departmentName: string; approverSlackId: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { departmentName, approverSlackId } = body;
  if (!departmentName) {
    return NextResponse.json({ error: "departmentName is required" }, { status: 400 });
  }

  try {
    // 該当部門の全メンバーの承認者を更新
    const empResult = await getEmployees();
    if (!empResult.success || !empResult.data?.employees) {
      return NextResponse.json({ error: "従業員マスタの取得に失敗しました" }, { status: 500 });
    }

    const members = empResult.data.employees.filter(
      (e) => (e.departmentName || "未所属") === departmentName
    );

    let updated = 0;
    for (const member of members) {
      const result = await updateApprover(member.name, approverSlackId);
      if (result.success) updated++;
    }

    return NextResponse.json({ success: true, updated, total: members.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
