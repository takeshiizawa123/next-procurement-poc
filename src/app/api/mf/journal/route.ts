import { NextRequest, NextResponse } from "next/server";
import { createJournal, buildJournalFromPurchase } from "@/lib/mf-accounting";
import { getStatus, updateStatus } from "@/lib/gas-client";
import { getSlackClient, notifyOps } from "@/lib/slack";

/**
 * 仕訳登録API
 * POST /api/mf/journal
 *
 * Body: { prNumber: string }
 *
 * 証憑完了の購買申請をMF会計Plusに仕訳登録し、
 * GASステータスを「計上済」に更新、Slackに通知。
 */
export async function POST(request: NextRequest) {
  try {
    const { prNumber } = (await request.json()) as { prNumber: string };
    if (!prNumber) {
      return NextResponse.json({ error: "prNumber is required" }, { status: 400 });
    }

    // GASから購買申請情報を取得
    const statusResult = await getStatus(prNumber);
    if (!statusResult.success || !statusResult.data) {
      return NextResponse.json(
        { error: `購買申請 ${prNumber} が見つかりません` },
        { status: 404 },
      );
    }

    const purchase = statusResult.data;

    // 証憑完了チェック
    const voucherStatus = (purchase as Record<string, string>)["証憑対応"] || "";
    if (voucherStatus !== "添付済") {
      return NextResponse.json(
        { error: `${prNumber} は証憑未完了です（現在: ${voucherStatus || "未添付"}）` },
        { status: 400 },
      );
    }

    // 仕訳リクエストを構築
    const amount = Number((purchase as Record<string, unknown>)["金額"] || 0);
    const journalRequest = await buildJournalFromPurchase({
      transactionDate: new Date().toISOString().split("T")[0],
      accountTitle: String((purchase as Record<string, unknown>)["勘定科目"] || "消耗品費"),
      amount,
      paymentMethod: String((purchase as Record<string, unknown>)["支払方法"] || ""),
      supplierName: String((purchase as Record<string, unknown>)["購入先"] || ""),
      department: String((purchase as Record<string, unknown>)["部門"] || ""),
      poNumber: prNumber,
    });

    // MF会計Plusに仕訳登録
    const journalResult = await createJournal(journalRequest);
    console.log("[mf-journal] Created:", { prNumber, journalId: journalResult.id });

    // GASステータスを「計上済」に更新
    await updateStatus(prNumber, {
      "仕訳ステータス": "計上済",
      "MF仕訳ID": String(journalResult.id),
    });

    // Slack通知
    try {
      const client = getSlackClient();
      await notifyOps(
        client,
        `✅ *仕訳登録完了* ${prNumber} — MF仕訳ID: ${journalResult.id} / ¥${amount.toLocaleString()}`,
      );
    } catch {
      // Slack通知失敗は無視
    }

    return NextResponse.json({
      ok: true,
      prNumber,
      journalId: journalResult.id,
      journalUrl: journalResult.url,
    });
  } catch (error) {
    console.error("[mf-journal] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
