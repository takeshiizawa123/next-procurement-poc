import { NextResponse } from "next/server";
import { getSuppliers } from "@/lib/gas-client";

/**
 * 購入先名一覧（サジェスト用）
 * GET /api/suppliers
 */
export async function GET() {
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
