import { NextRequest, NextResponse } from "next/server";
import { updatePredictionStatus } from "@/lib/gas-client";
import { createJournal, resolveAccountCode, resolveTaxCode } from "@/lib/mf-accounting";
import { requireBearerAuth } from "@/lib/api-auth";

/**
 * カード照合確定API（認証必須）
 * POST /api/admin/card-matching/confirm
 *
 * Body: {
 *   predictionId: string;     // 予測レコードID
 *   poNumber: string;         // 購買番号
 *   journalId: number;        // Stage 2 仕訳ID
 *   predictedAmount: number;  // 予測金額
 *   actualAmount: number;     // 実際のカード金額
 *   accountTitle?: string;    // 勘定科目名（差額調整用）
 *   transactionDate: string;  // 取引日 YYYY-MM-DD
 *   supplier: string;         // 購入先
 * }
 *
 * 予測テーブルを「matched」に更新し、
 * 差額がある場合は調整仕訳を自動作成する。
 */
export async function POST(request: NextRequest) {
  const authError = requireBearerAuth(request);
  if (authError) return authError;

  try {
    const body = (await request.json()) as {
      predictionId: string;
      poNumber: string;
      journalId: number;
      predictedAmount: number;
      actualAmount: number;
      accountTitle?: string;
      transactionDate: string;
      supplier: string;
    };

    const {
      predictionId,
      poNumber,
      journalId,
      predictedAmount,
      actualAmount,
      accountTitle,
      transactionDate,
      supplier,
    } = body;

    if (!predictionId || !poNumber || !journalId) {
      return NextResponse.json(
        { error: "predictionId, poNumber, journalId は必須です" },
        { status: 400 },
      );
    }

    const diff = actualAmount - predictedAmount;
    const now = new Date().toISOString();

    // GAS予測テーブルのステータスを「matched」に更新
    await updatePredictionStatus(predictionId, {
      status: "matched",
      matched_journal_id: journalId,
      matched_at: now,
      amount_diff: diff,
    });

    let adjustmentJournalId: number | null = null;

    // 差額がある場合は調整仕訳を作成
    if (diff !== 0) {
      const absDiff = Math.abs(diff);

      // 勘定科目を解決（費用科目）
      const mainAccount = accountTitle?.split("（")[0].trim() || "消耗品費";
      const debitAccountCode = await resolveAccountCode(mainAccount) || mainAccount;
      const creditAccountCode = await resolveAccountCode("未払金") || "未払金";
      const taxCode = await resolveTaxCode("共-課仕 10%");

      // 税額計算（10%税込み前提）
      const taxValue = Math.floor(absDiff * 10 / 110);

      const journal = await createJournal({
        status: "draft",
        transaction_date: transactionDate,
        journal_type: "journal_entry",
        tags: [poNumber, "Stage2-adj"],
        memo: `${poNumber} 差額調整 ${diff > 0 ? "+" : ""}¥${diff.toLocaleString()} ${supplier}`,
        branches: [
          {
            remark: `${poNumber} ${supplier} カード差額調整`,
            debitor: {
              account_code: diff > 0 ? debitAccountCode : creditAccountCode,
              ...(diff > 0 && taxCode ? { tax_code: taxCode } : {}),
              value: absDiff,
              ...(diff > 0 ? { tax_value: taxValue } : {}),
            },
            creditor: {
              account_code: diff > 0 ? creditAccountCode : debitAccountCode,
              ...(diff < 0 && taxCode ? { tax_code: taxCode } : {}),
              value: absDiff,
              ...(diff < 0 ? { tax_value: taxValue } : {}),
            },
          },
        ],
      });

      adjustmentJournalId = journal.id;
      console.log(
        `[card-matching] Adjustment journal created: ${journal.id} — ` +
        `${poNumber} ${diff > 0 ? "+" : ""}¥${diff.toLocaleString()}`,
      );
    }

    return NextResponse.json({
      ok: true,
      predictionId,
      poNumber,
      status: "matched",
      diff,
      adjustmentJournalId,
    });
  } catch (error) {
    console.error("[card-matching] Confirm error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
