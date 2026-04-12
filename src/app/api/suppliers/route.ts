import { NextRequest, NextResponse } from "next/server";
import { getSuppliers } from "@/lib/gas-client";
import { requireApiKey } from "@/lib/api-auth";

/**
 * 購入先名一覧（APIキー認証）
 * GET /api/suppliers
 */
export async function GET(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;
  try {
    const result = await getSuppliers();
    if (!result.success) {
      return NextResponse.json({ suppliers: [] });
    }
    const res = NextResponse.json(result.data);
    res.headers.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
    return res;
  } catch {
    return NextResponse.json({ suppliers: [] });
  }
}
