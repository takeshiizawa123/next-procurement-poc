import { NextRequest, NextResponse } from "next/server";
import { estimateAccountFromHistory } from "@/lib/account-estimator";
import { getStatus, updateStatus } from "@/lib/gas-client";
import { requireApiKey } from "@/lib/api-auth";
import { getSlackClient, notifyOps } from "@/lib/slack";

/**
 * 勘定科目再推定API（経理向け）
 * POST /api/purchase/estimate-account
 *
 * Body: { prNumber: string }
 * → 購買データから勘定科目をRAG推定し、GASに保存して結果を返す
 */
export async function POST(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  try {
    const body = await request.json() as { prNumber?: string };
    const prNumber = body.prNumber?.trim();
    if (!prNumber) {
      return NextResponse.json({ error: "prNumber is required" }, { status: 400 });
    }

    // GASから購買データを取得
    const statusResult = await getStatus(prNumber);
    if (!statusResult.success || !statusResult.data) {
      return NextResponse.json({ error: "購買データが見つかりません" }, { status: 404 });
    }

    const data = statusResult.data as Record<string, unknown>;
    const itemName = String(data["品目名"] || "");
    const supplier = String(data["購入先"] || "");
    const totalAmount = Number(data["合計額（税込）"] || data["合計額（税抜）"] || 0);
    const department = String(data["部門"] || "") || undefined;
    const unitPrice = Number(data["単価"] || 0) || undefined;
    const ocrItems = data["証憑品名"] ? String(data["証憑品名"]) : undefined;

    const estimation = await estimateAccountFromHistory(
      ocrItems || itemName,
      supplier,
      totalAmount,
      department,
      undefined,
      unitPrice,
    );

    // GASに推定結果を保存
    await updateStatus(prNumber, { "勘定科目": estimation.account });

    // 低信頼度の場合はOPSチャンネルに通知（管理本部レビュー必須）
    if (estimation.confidence === "low") {
      try {
        const client = getSlackClient();
        await notifyOps(client, [
          `⚠️ *勘定科目推定: 低信頼度* — ${prNumber}`,
          `  品目: ${itemName}`,
          `  推定: ${estimation.account}（${estimation.reason}）`,
          `  → 仕訳管理画面で確認・修正をお願いします`,
        ].join("\n"));
      } catch { /* 通知失敗は無視 */ }
    }

    return NextResponse.json({
      prNumber,
      account: estimation.account,
      confidence: estimation.confidence,
      reason: estimation.reason,
      taxType: ("taxType" in estimation ? (estimation as { taxType?: string }).taxType : undefined),
    });
  } catch (error) {
    console.error("[estimate-account] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
