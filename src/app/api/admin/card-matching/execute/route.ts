import { NextRequest, NextResponse } from "next/server";
import {
  getPredictedTransactions,
  getEmployeeCards,
  getRecentRequests,
} from "@/lib/gas-client";
import { getJournals } from "@/lib/mf-accounting";
import { executeMatching, type CardStatementInput } from "@/lib/card-matcher";
import { requireBearerAuth } from "@/lib/api-auth";
import { updatePredictionStatus } from "@/lib/gas-client";
import { createJournal, resolveAccountCode, resolveTaxCode } from "@/lib/mf-accounting";

/**
 * カード明細照合API（認証必須）
 * POST /api/admin/card-matching/execute
 *
 * Body: {
 *   month: string;          // "2026-03"
 *   statements: CardStatementInput[];  // CSVパース済みカード明細
 * }
 *
 * フロントからCSVパース済み明細を受け取り、
 * GAS予測テーブル + MF会計Plus仕訳 + 従業員マスタを取得して
 * 2フェーズ照合を実行、4区分の結果を返す。
 */
export async function POST(request: NextRequest) {
  const authError = requireBearerAuth(request);
  if (authError) return authError;

  try {
    const body = (await request.json()) as {
      month: string;
      statements: CardStatementInput[];
    };

    const { month, statements } = body;

    if (!month || !statements || !Array.isArray(statements)) {
      return NextResponse.json(
        { error: "month (string) と statements (array) が必要です" },
        { status: 400 },
      );
    }

    if (statements.length === 0) {
      return NextResponse.json(
        { error: "カード明細が0件です。CSVを確認してください" },
        { status: 400 },
      );
    }

    // 日付フォーマット補正: "03/15" → "2026-03-15"
    const year = month.split("-")[0];
    const normalizedStatements = statements.map((s) => ({
      ...s,
      date: normalizeDate(s.date, year),
    }));

    console.log(
      `[card-matching] Execute: month=${month}, statements=${statements.length}`,
    );

    // 並列でデータ取得
    const [predictionsRes, employeeCardsRes, journalsResult] = await Promise.all([
      getPredictedTransactions(month),
      getEmployeeCards(),
      fetchJournalsForMonth(month),
    ]);

    const predictions = predictionsRes.success
      ? (predictionsRes.data?.predictions || [])
      : [];
    const employeeCards = employeeCardsRes.success
      ? (employeeCardsRes.data?.employees || [])
      : [];

    console.log(
      `[card-matching] Data: predictions=${predictions.length}, ` +
      `employees=${employeeCards.length}, journals=${journalsResult.length}`,
    );

    // マッチング実行
    const result = executeMatching({
      statements: normalizedStatements,
      predictions,
      journals: journalsResult,
      employeeCards,
      month,
    });

    console.log(
      `[card-matching] Result: confident=${result.summary.confidentCount}, ` +
      `candidate=${result.summary.candidateCount}, ` +
      `unmatched=${result.summary.unmatchedCount}, ` +
      `unreported=${result.summary.unreportedCount}, ` +
      `matchRate=${result.summary.matchRate}%`,
    );

    // 自動照合済みの差額分について調整仕訳を非同期で作成
    const adjustmentResults: Array<{ poNumber: string; diff: number; journalId?: number }> = [];
    for (const m of result.confidentMatches) {
      if (m.diff === 0) continue;

      try {
        const absDiff = Math.abs(m.diff);
        const debitCode = await resolveAccountCode("消耗品費") || "消耗品費";
        const creditCode = await resolveAccountCode("未払金") || "未払金";
        const taxCode = await resolveTaxCode("共-課仕 10%");
        const taxValue = Math.floor(absDiff * 10 / 110);

        const journal = await createJournal({
          status: "draft",
          transaction_date: m.date,
          journal_type: "journal_entry",
          tags: [m.poNumber, "Stage2-adj"],
          memo: `${m.poNumber} 差額調整 ${m.diff > 0 ? "+" : ""}¥${m.diff.toLocaleString()} ${m.supplier}`,
          branches: [
            {
              remark: `${m.poNumber} ${m.supplier} カード差額調整`,
              debitor: {
                account_code: m.diff > 0 ? debitCode : creditCode,
                ...(m.diff > 0 && taxCode ? { tax_code: taxCode } : {}),
                value: absDiff,
                ...(m.diff > 0 ? { tax_value: taxValue } : {}),
              },
              creditor: {
                account_code: m.diff > 0 ? creditCode : debitCode,
                ...(m.diff < 0 && taxCode ? { tax_code: taxCode } : {}),
                value: absDiff,
                ...(m.diff < 0 ? { tax_value: taxValue } : {}),
              },
            },
          ],
        });
        adjustmentResults.push({ poNumber: m.poNumber, diff: m.diff, journalId: journal.id });
        console.log(`[card-matching] Adjustment: ${m.poNumber} ${m.diff > 0 ? "+" : ""}¥${m.diff} → journal ${journal.id}`);
      } catch (e) {
        console.error(`[card-matching] Adjustment journal error for ${m.poNumber}:`, e);
        adjustmentResults.push({ poNumber: m.poNumber, diff: m.diff });
      }
    }

    return NextResponse.json({ ok: true, ...result, adjustmentResults });
  } catch (error) {
    console.error("[card-matching] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/**
 * 月の仕訳を取得（entered_by=none でカード自動仕訳 = Stage 2）
 */
async function fetchJournalsForMonth(month: string) {
  try {
    const [y, m] = month.split("-").map(Number);
    const from = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const to = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    return await getJournals({ from, to, enteredBy: "none" });
  } catch (e) {
    console.warn("[card-matching] Failed to fetch journals:", e);
    return [];
  }
}

/**
 * 日付フォーマット補正
 * "03/15" → "2026-03-15"
 * "2026-03-15" → そのまま
 */
function normalizeDate(date: string, year: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;

  const m = date.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }

  return date;
}
