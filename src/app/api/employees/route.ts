import { NextResponse } from "next/server";
import { getEmployees } from "@/lib/gas-client";

/**
 * 従業員マスタ一覧を返す
 * GET /api/employees
 *
 * GAS Web Appの従業員マスタをプロキシ。
 * Webフォームの申請者サジェストに使用。
 */
export async function GET() {
  try {
    const result = await getEmployees();
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "従業員マスタの取得に失敗しました" },
        { status: 500 },
      );
    }
    return NextResponse.json(result.data);
  } catch (error) {
    console.error("[employees] Error:", error);
    return NextResponse.json(
      { error: "従業員マスタの取得に失敗しました" },
      { status: 500 },
    );
  }
}
