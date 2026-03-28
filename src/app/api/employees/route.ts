import { NextRequest, NextResponse } from "next/server";
import { getEmployees } from "@/lib/gas-client";
import { requireApiKey } from "@/lib/api-auth";

/**
 * 従業員マスタ一覧を返す（APIキー認証）
 * GET /api/employees
 *
 * GAS Web Appの従業員マスタをプロキシ。
 * Webフォームの申請者サジェストに使用。
 */
export async function GET(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;
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
