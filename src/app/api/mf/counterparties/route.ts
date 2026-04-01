import { NextRequest, NextResponse } from "next/server";
import { getCounterparties } from "@/lib/mf-accounting";
import { requireApiKey } from "@/lib/api-auth";

/**
 * MF会計Plus 取引先マスタ検索API
 * GET /api/mf/counterparties?q=検索文字列
 *
 * 購買申請フォームの購入先サジェスト（請求書払い時）に使用。
 */
export async function GET(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const q = request.nextUrl.searchParams.get("q")?.trim() || "";

  try {
    const all = await getCounterparties();
    const results = q
      ? all.filter((c) =>
          c.name.includes(q) ||
          c.code?.includes(q) ||
          c.search_key?.includes(q) ||
          c.invoice_registration_number?.includes(q)
        )
      : all;

    return NextResponse.json({
      counterparties: results.slice(0, 50).map((c) => ({
        code: c.code,
        name: c.name,
        invoiceNumber: c.invoice_registration_number,
      })),
    });
  } catch (error) {
    console.error("[mf-counterparties] Error:", error);
    return NextResponse.json(
      { counterparties: [], error: "MF会計Plusの取引先マスタを取得できませんでした。認証状態を確認してください。" },
      { status: 200 }, // フォームのサジェストが壊れないよう200で返す
    );
  }
}
