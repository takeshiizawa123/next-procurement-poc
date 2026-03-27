import { NextRequest, NextResponse } from "next/server";
import {
  getPredictedTransactions,
  getEmployeeCards,
  getRecentRequests,
} from "@/lib/gas-client";
import { getJournals } from "@/lib/mf-accounting";
import { executeMatching, type CardStatementInput } from "@/lib/card-matcher";

/**
 * カード明細照合API
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

    return NextResponse.json({ ok: true, ...result });
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
