import { NextRequest, NextResponse } from "next/server";
import { estimateAccount } from "@/lib/account-estimator";
import { requireApiKey } from "@/lib/api-auth";

/**
 * 勘定科目推定（APIキー認証）
 * GET /api/purchase/estimate-account?itemName=xxx&supplierName=yyy&totalAmount=zzz
 */
export async function GET(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;
  const { searchParams } = new URL(request.url);
  const itemName = searchParams.get("itemName") || "";
  const supplierName = searchParams.get("supplierName") || "";
  const totalAmount = Number(searchParams.get("totalAmount") || "0");

  const estimation = estimateAccount(itemName, supplierName, totalAmount);
  return NextResponse.json(estimation);
}
