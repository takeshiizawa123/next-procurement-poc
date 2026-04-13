import { NextRequest, NextResponse } from "next/server";
import { updatePredictionStatus } from "@/lib/gas-client";
import {
  createJournal,
  resolveAccountCode,
  resolveSubAccountCode,
  resolveTaxCode,
} from "@/lib/mf-accounting";
import { requireAdminAuth } from "@/lib/api-auth";

/**
 * カード照合確定API（認証必須）
 * POST /api/admin/card-matching/confirm
 *
 * Body: {
 *   predictionId: string;     // 予測レコードID
 *   poNumber: string;         // 購買番号
 *   journalId?: number;       // 既存の Stage 2 仕訳ID（未指定なら自動作成）
 *   predictedAmount: number;  // 予測金額
 *   actualAmount: number;     // 実際のカード金額
 *   accountTitle?: string;    // 勘定科目名（差額調整用）
 *   transactionDate: string;  // 取引日 YYYY-MM-DD
 *   supplier: string;         // 購入先
 * }
 *
 * Stage 2仕訳を自動作成（未払金:未請求 → 未払金:請求）し、
 * 予測テーブルを「matched」に更新する。
 * 差額がある場合は調整仕訳も自動作成する。
 */
export async function POST(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const body = (await request.json()) as {
      predictionId: string;
      poNumber: string;
      journalId?: number;
      predictedAmount: number;
      actualAmount: number;
      accountTitle?: string;
      transactionDate: string;
      supplier: string;
    };

    const {
      predictionId,
      poNumber,
      predictedAmount,
      actualAmount,
      accountTitle,
      transactionDate,
      supplier,
    } = body;

    if (!predictionId || !poNumber) {
      return NextResponse.json(
        { error: "predictionId, poNumber は必須です" },
        { status: 400 },
      );
    }

    const diff = actualAmount - predictedAmount;
    const now = new Date().toISOString();

    // --- Stage 2 仕訳: 未払金:MFカード:未請求 → 未払金:MFカード:請求 ---
    let stage2JournalId = body.journalId || 0;

    if (!body.journalId) {
      const unpaidCode = await resolveAccountCode("未払金") || "未払金";
      const [subUnrequestedCode, subBilledCode] = await Promise.all([
        resolveSubAccountCode("未払金", "MFカード:未請求"),
        resolveSubAccountCode("未払金", "MFカード:請求"),
      ]);

      const stage2Journal = await createJournal({
        status: "draft",
        transaction_date: transactionDate,
        journal_type: "journal_entry",
        tags: [poNumber, "Stage2"],
        memo: `${poNumber} Stage2 請求確定 ${supplier}`,
        branches: [
          {
            remark: `${poNumber} ${supplier} カード明細マッチ（未請求→請求）`,
            debitor: {
              account_code: unpaidCode,
              ...(subUnrequestedCode ? { sub_account_code: subUnrequestedCode } : {}),
              value: actualAmount,
            },
            creditor: {
              account_code: unpaidCode,
              ...(subBilledCode ? { sub_account_code: subBilledCode } : {}),
              value: actualAmount,
            },
          },
        ],
      });

      stage2JournalId = stage2Journal.id;
      console.log(
        `[card-matching] Stage 2 journal created: ${stage2Journal.id} — ` +
        `${poNumber} ¥${actualAmount.toLocaleString()} ${supplier}`,
      );
    }

    // 予測テーブルのステータスを「matched」に更新
    await updatePredictionStatus(predictionId, {
      status: "matched",
      matched_journal_id: stage2JournalId,
      matched_at: now,
      amount_diff: diff,
    });

    let adjustmentJournalId: number | null = null;

    // 差額がある場合は調整仕訳を作成
    if (diff !== 0) {
      const absDiff = Math.abs(diff);

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
      stage2JournalId,
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
