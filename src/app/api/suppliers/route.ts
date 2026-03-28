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
    return NextResponse.json(result.data);
  } catch {
    return NextResponse.json({ suppliers: [] });
  }
}
