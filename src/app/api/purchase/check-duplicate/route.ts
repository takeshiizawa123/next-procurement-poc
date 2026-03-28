import { NextRequest, NextResponse } from "next/server";
import { checkDuplicate } from "@/lib/gas-client";
import { requireApiKey } from "@/lib/api-auth";

/**
 * 重複チェック（APIキー認証）
 * GET /api/purchase/check-duplicate?itemName=xxx&totalAmount=yyy
 */
export async function GET(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;
  const { searchParams } = new URL(request.url);
  const itemName = searchParams.get("itemName");
  const totalAmount = searchParams.get("totalAmount");

  if (!itemName) {
    return NextResponse.json({ duplicates: [] });
  }

  try {
    const result = await checkDuplicate(
      itemName,
      totalAmount ? Number(totalAmount) : undefined,
    );
    if (!result.success) {
      return NextResponse.json({ duplicates: [] });
    }
    return NextResponse.json(result.data);
  } catch {
    return NextResponse.json({ duplicates: [] });
  }
}
