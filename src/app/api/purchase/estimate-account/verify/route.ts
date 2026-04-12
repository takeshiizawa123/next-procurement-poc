import { NextRequest, NextResponse } from "next/server";
import { estimateAccountFromHistory } from "@/lib/account-estimator";
import { getJournalStats, searchJournalRows } from "@/lib/gas-client";
import type { JournalRow, CounterpartyAccountStat } from "@/lib/gas-client";
import { requireApiKey } from "@/lib/api-auth";

// Vercel Pro: 最大300秒
export const maxDuration = 300;

/**
 * RAG推定 精度検証API（過去仕訳ベース）
 * GET /api/purchase/estimate-account/verify?limit=20
 *
 * 過去仕訳の原票データを「正解ラベル付きテストデータ」として使用。
 * 取引先ごとに原票を取得し、品名(remark)+取引先でRAG推定→実際の科目と比較。
 *
 * ※ Claude API呼び出しを伴う（1件あたり1回）。limit=30で約30回。
 */
export async function GET(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") || "20"), 50);

  try {
    // 過去仕訳統計を取得（取引先×科目、品名キーワード×科目）
    const stats = await getJournalStats();
    if (!stats) {
      return NextResponse.json({ error: "仕訳統計の取得に失敗" }, { status: 500 });
    }

    // B/S科目を除外して費用科目のテストケースのみ抽出
    const BS_ACCOUNTS = new Set([
      "普通預金", "当座預金", "現金", "未払金", "買掛金", "売掛金",
      "前受金", "前払金", "預り金", "仮受金", "仮払金", "立替金",
      "受取手形", "支払手形", "短期借入金", "長期借入金",
      "資本金", "利益剰余金", "売上高",
    ]);

    // 取引先ごとに代表的な原票をサンプリング
    // 件数の多い取引先から順に、多様な取引先をカバー
    const counterparties = stats.counterpartyAccounts
      .filter((s: CounterpartyAccountStat) => !BS_ACCOUNTS.has(s.account) && s.count >= 2)
      .sort((a: CounterpartyAccountStat, b: CounterpartyAccountStat) => b.count - a.count);

    // 取引先の重複を排除（1取引先あたり最大1テストケース）
    const seen = new Set<string>();
    const testCounterparties: CounterpartyAccountStat[] = [];
    for (const cp of counterparties) {
      if (seen.has(cp.counterparty)) continue;
      seen.add(cp.counterparty);
      testCounterparties.push(cp);
      if (testCounterparties.length >= limit) break;
    }

    // 各取引先の原票を検索し、テストケースを構築
    type TestResult = {
      counterparty: string;
      remark: string;
      department: string;
      amount: number;
      actualAccount: string;
      actualTaxType: string;
      predictedAccount: string;
      predictedTaxType?: string;
      confidence: string;
      reason: string;
      match: boolean;
      statCount: number;
    };

    // Phase 1: GAS原票検索を並列実行（GASは比較的速い）
    const rowsMap = new Map<string, JournalRow | null>();
    const BATCH_SIZE = 5;
    for (let i = 0; i < testCounterparties.length; i += BATCH_SIZE) {
      const batch = testCounterparties.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (cp) => {
          try {
            const rows = await searchJournalRows(cp.counterparty, "");
            return { cp, row: pickRepresentativeRow(rows?.supplierMatches || [], cp.account) };
          } catch {
            return { cp, row: null };
          }
        }),
      );
      for (const { cp, row } of batchResults) {
        rowsMap.set(cp.counterparty, row);
      }
    }

    // Phase 2: RAG推定を直列実行（Claude API呼び出し — 並列だとレート制限に引っかかる）
    const results: TestResult[] = [];
    for (const cp of testCounterparties) {
      const sampleRow = rowsMap.get(cp.counterparty);
      if (!sampleRow) continue;

      try {
        const estimation = await estimateAccountFromHistory(
          sampleRow.remark,
          sampleRow.counterparty,
          sampleRow.amount,
          sampleRow.department || undefined,
          undefined,
          undefined,
        );

        results.push({
          counterparty: sampleRow.counterparty,
          remark: sampleRow.remark,
          department: sampleRow.department,
          amount: sampleRow.amount,
          actualAccount: sampleRow.account,
          actualTaxType: sampleRow.taxType,
          predictedAccount: estimation.account,
          predictedTaxType: "taxType" in estimation ? (estimation as { taxType?: string }).taxType : undefined,
          confidence: estimation.confidence,
          reason: estimation.reason,
          match: estimation.account === sampleRow.account,
          statCount: cp.count,
        });
      } catch (e) {
        console.warn(`[verify] Error for ${cp.counterparty}:`, e);
      }
    }

    // 集計
    const total = results.length;
    const correct = results.filter((r) => r.match).length;
    const accuracy = total > 0 ? Math.round((correct / total) * 1000) / 10 : 0;

    const byConfidence = (["high", "medium", "low"] as const).map((c) => {
      const group = results.filter((r) => r.confidence === c);
      const groupCorrect = group.filter((r) => r.match).length;
      return {
        confidence: c,
        total: group.length,
        correct: groupCorrect,
        accuracy: group.length > 0 ? Math.round((groupCorrect / group.length) * 1000) / 10 : 0,
      };
    });

    // 税区分の一致率も計測
    const taxResults = results.filter((r) => r.predictedTaxType);
    const taxCorrect = taxResults.filter((r) => r.predictedTaxType === r.actualTaxType).length;
    const taxAccuracy = taxResults.length > 0 ? Math.round((taxCorrect / taxResults.length) * 1000) / 10 : 0;

    const mismatches = results.filter((r) => !r.match);

    return NextResponse.json({
      summary: {
        totalCounterparties: counterparties.length,
        tested: total,
        correct,
        accuracy: `${accuracy}%`,
        taxAccuracy: `${taxAccuracy}% (${taxCorrect}/${taxResults.length})`,
        byConfidence,
      },
      mismatches,
      allResults: results,
    });
  } catch (error) {
    console.error("[verify] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/**
 * 原票リストから、指定科目に該当する代表的な行を1つ選ぶ。
 * 直近の日付を優先。
 */
function pickRepresentativeRow(rows: JournalRow[], targetAccount: string): JournalRow | null {
  // 指定科目の行を探す
  const matching = rows.filter((r) => r.account === targetAccount && r.remark);
  if (matching.length > 0) {
    // 日付降順で最新のものを返す
    return matching.sort((a, b) => b.date.localeCompare(a.date))[0];
  }
  // 科目一致がなければ、remarkがある最新の行を返す
  const withRemark = rows.filter((r) => r.remark);
  if (withRemark.length > 0) {
    return withRemark.sort((a, b) => b.date.localeCompare(a.date))[0];
  }
  return null;
}
