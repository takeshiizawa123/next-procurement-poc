import { NextRequest, NextResponse } from "next/server";
import { updateStatus, getStatus, invalidateRecentRequests } from "@/lib/gas-client";
import { updateSlackMessageForWebAction } from "@/lib/slack";
import { cacheGet, cacheSet, cacheDelete } from "@/lib/cache";
import { isEcLinkedSite, VOUCHER_STATUS_MF_AUTO } from "@/lib/ec-sites";

const CACHE_PREFIX = "purchase:";
const CACHE_TTL = 60_000; // 60秒

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

  let body: { action: string; comment?: string; operatorName?: string; deliveryNote?: "attached" | "none"; supplierName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action, comment, operatorName } = body;

  // アクションに応じて更新フィールドを決定
  const updates: Record<string, string> = {};
  switch (action) {
    case "order_complete":
      updates["発注ステータス"] = "発注済";
      break;
    case "inspection_complete": {
      updates["検収ステータス"] = "検収済";
      updates["検収日"] = new Date().toISOString().slice(0, 10);
      if (comment) updates["検収コメント"] = comment;
      // 納品書ステータス
      updates["納品書"] = body.deliveryNote === "attached" ? "添付済" : "なし";
      // EC連携サイトなら証憑はMF自動取得、それ以外は手動要求
      const supplier = body.supplierName || "";
      updates["証憑対応"] = isEcLinkedSite(supplier) ? VOUCHER_STATUS_MF_AUTO : "要取得";
      break;
    }
    case "approve":
      updates["発注承認ステータス"] = "承認済";
      break;
    case "reject":
      updates["発注承認ステータス"] = "差戻し";
      if (comment) updates["差戻し理由"] = comment;
      break;
    case "cancel":
      updates["発注承認ステータス"] = "取消";
      updates["取消日"] = new Date().toISOString().slice(0, 10);
      break;
    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  try {
    const result = await updateStatus(prNumber, updates);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.statusCode || 500 });
    }
    // キャッシュ無効化
    cacheDelete(`${CACHE_PREFIX}${prNumber}`);
    await invalidateRecentRequests();
    // 更新後の最新データを返す
    const status = await getStatus(prNumber);
    if (status.success && status.data) {
      cacheSet(`${CACHE_PREFIX}${prNumber}`, status.data, CACHE_TTL);
      // Slackメッセージのブロックを書き換え
      const purchaseData = status.data as Record<string, unknown>;
      try {
        await updateSlackMessageForWebAction(
          prNumber, action, operatorName || "Web", purchaseData,
        );
      } catch (slackErr) {
        console.error(`[purchase-status] Slack update error:`, slackErr);
      }
    }
    return NextResponse.json({ success: true, data: status.data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[purchase-status] Error updating ${prNumber}:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * 仕訳編集内容をGASに保存
 * PUT /api/purchase/[prNumber]/status
 * Body: { updates: Record<string, string> }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ prNumber: string }> },
) {
  const { prNumber } = await params;
  if (!prNumber) {
    return NextResponse.json({ error: "prNumber is required" }, { status: 400 });
  }

  let body: { updates: Record<string, string> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.updates || Object.keys(body.updates).length === 0) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  // 更新可能なフィールドを制限
  const allowed = ["勘定科目", "税区分", "部門", "MF取引先", "MF摘要", "HubSpot案件番号", "適格番号"];
  const filtered: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.updates)) {
    if (allowed.includes(k)) filtered[k] = v;
  }

  if (Object.keys(filtered).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  try {
    const result = await updateStatus(prNumber, filtered);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.statusCode || 500 });
    }
    cacheDelete(`${CACHE_PREFIX}${prNumber}`);
    return NextResponse.json({ success: true, updated: Object.keys(filtered) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[purchase-status] PUT error ${prNumber}:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * 購買申請の詳細データを取得（60秒キャッシュ付き）
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ prNumber: string }> },
) {
  const { prNumber } = await params;
  if (!prNumber) {
    return NextResponse.json({ error: "prNumber is required" }, { status: 400 });
  }

  // キャッシュヒット
  const cached = cacheGet<Record<string, unknown>>(`${CACHE_PREFIX}${prNumber}`);
  if (cached) {
    return NextResponse.json({ success: true, data: cached, cached: true });
  }

  try {
    const result = await getStatus(prNumber);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.statusCode || 404 });
    }
    // キャッシュに保存
    if (result.data) {
      cacheSet(`${CACHE_PREFIX}${prNumber}`, result.data, CACHE_TTL);
    }
    return NextResponse.json({ success: true, data: result.data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
