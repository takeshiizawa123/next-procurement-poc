import { NextResponse } from "next/server";
import { testConnection, updateStatus } from "@/lib/gas-client";

/**
 * GAS連携テスト用エンドポイント
 *
 * GET /api/test/gas        — GAS接続テスト（health check）
 * POST /api/test/gas       — ステータス更新テスト
 */

export async function GET() {
  try {
    const result = await testConnection();
    return NextResponse.json({
      ok: true,
      message: "GAS connection test",
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const result = await updateStatus("PO-2025-TEST", {
      発注承認ステータス: "承認済",
    });
    return NextResponse.json({
      ok: true,
      message: "Status update test",
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
