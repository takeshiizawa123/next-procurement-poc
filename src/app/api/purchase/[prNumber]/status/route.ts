import { NextRequest, NextResponse } from "next/server";
import { updateStatus, getStatus } from "@/lib/gas-client";

/**
 * 購買申請のステータスを更新（発注完了・検収完了）
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ prNumber: string }> },
) {
  const { prNumber } = await params;
  if (!prNumber) {
    return NextResponse.json({ error: "prNumber is required" }, { status: 400 });
  }

  let body: { action: string; comment?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action, comment } = body;

  // アクションに応じて更新フィールドを決定
  const updates: Record<string, string> = {};
  switch (action) {
    case "order_complete":
      updates["発注ステータス"] = "発注済";
      break;
    case "inspection_complete":
      updates["検収ステータス"] = "検収済";
      updates["検収日"] = new Date().toISOString().slice(0, 10);
      if (comment) updates["検収コメント"] = comment;
      // 検収後は証憑を要求
      updates["証憑対応"] = "要取得";
      break;
    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  try {
    const result = await updateStatus(prNumber, updates);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.statusCode || 500 });
    }
    // 更新後の最新データを返す
    const status = await getStatus(prNumber);
    return NextResponse.json({ success: true, data: status.data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[purchase-status] Error updating ${prNumber}:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * 購買申請の詳細データを取得
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ prNumber: string }> },
) {
  const { prNumber } = await params;
  if (!prNumber) {
    return NextResponse.json({ error: "prNumber is required" }, { status: 400 });
  }

  try {
    const result = await getStatus(prNumber);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.statusCode || 404 });
    }
    return NextResponse.json({ success: true, data: result.data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
