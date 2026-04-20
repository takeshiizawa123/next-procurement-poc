import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/api-auth";
import { getJournals, getAccounts, getCounterparties } from "@/lib/mf-accounting";

/**
 * 特定種別の仕訳の詳細内訳を返す
 * GET /api/admin/analyze-journal-detail?month=YYYY-MM&debitKeyword=未払費用系 or creditKeyword=未払費用
 *
 * 例: credit_account_name に「未払費用」を含む仕訳の借方科目別・取引先別集計
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matchFilter(journal: any, accountIdToName: Map<number, string>, debitKeyword?: string, creditKeyword?: string): boolean {
  const branches = journal.branches || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const firstDebit = branches.find((b: any) => b?.debitor?.account_id != null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const firstCredit = branches.find((b: any) => b?.creditor?.account_id != null);
  const dName = firstDebit?.debitor?.account_id != null ? accountIdToName.get(firstDebit.debitor.account_id) || "" : "";
  const cName = firstCredit?.creditor?.account_id != null ? accountIdToName.get(firstCredit.creditor.account_id) || "" : "";

  if (debitKeyword && !dName.includes(debitKeyword)) return false;
  if (creditKeyword && !cName.includes(creditKeyword)) return false;
  return true;
}

export async function GET(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const month = request.nextUrl.searchParams.get("month") || new Date().toISOString().slice(0, 7);
    const debitKeyword = request.nextUrl.searchParams.get("debitKeyword") || "";
    const creditKeyword = request.nextUrl.searchParams.get("creditKeyword") || "";

    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "month は YYYY-MM 形式" }, { status: 400 });
    }

    if (!debitKeyword && !creditKeyword) {
      return NextResponse.json({ error: "debitKeyword or creditKeyword 必須" }, { status: 400 });
    }

    const [yStr, mStr] = month.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    const from = `${yStr}-${mStr}-01`;
    const to = new Date(y, m, 0).toISOString().split("T")[0];

    // マスタ取得
    const [accounts, counterparties] = await Promise.all([getAccounts(), getCounterparties()]);
    const accountIdToName = new Map<number, string>();
    for (const a of accounts) accountIdToName.set(a.id, a.name);
    const counterpartyIdToName = new Map<number, string>();
    for (const c of counterparties) counterpartyIdToName.set(c.id, c.name);

    // 通常仕訳のみ取得
    const journals = await getJournals({ from, to });
    const regularJournals = journals.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (j: any) => j.journal_type !== "adjusting_entry",
    );

    // フィルタ
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filtered = regularJournals.filter((j: any) => matchFilter(j, accountIdToName, debitKeyword, creditKeyword));

    // 集計: 借方科目 × 取引先 × 金額範囲
    const byDebitAccount: Record<string, { count: number; total: number }> = {};
    const byCounterparty: Record<string, { count: number; total: number; accounts: Set<string> }> = {};
    const byDebitCounterparty: Record<string, { count: number; total: number; amounts: number[]; accountName: string; counterpartyName: string }> = {};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const j of filtered as any[]) {
      const branches = j.branches || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const firstDebit = branches.find((b: any) => b?.debitor?.account_id != null) as any;
      if (!firstDebit) continue;
      const accountId = firstDebit.debitor.account_id as number;
      const accountName = accountIdToName.get(accountId) || `account_id=${accountId}`;
      const counterpartyId = firstDebit.debitor.counterparty_id as number | undefined;
      const counterpartyName = counterpartyId ? (counterpartyIdToName.get(counterpartyId) || `cpid=${counterpartyId}`) : "(取引先なし)";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const amount = branches.reduce((s: number, b: any) => s + (b.debitor?.value || 0), 0);

      // 借方科目別
      if (!byDebitAccount[accountName]) byDebitAccount[accountName] = { count: 0, total: 0 };
      byDebitAccount[accountName].count++;
      byDebitAccount[accountName].total += amount;

      // 取引先別
      if (!byCounterparty[counterpartyName]) byCounterparty[counterpartyName] = { count: 0, total: 0, accounts: new Set() };
      byCounterparty[counterpartyName].count++;
      byCounterparty[counterpartyName].total += amount;
      byCounterparty[counterpartyName].accounts.add(accountName);

      // 借方×取引先組合せ（繰り返しパターン検出用）
      const pairKey = `${accountName}|${counterpartyName}`;
      if (!byDebitCounterparty[pairKey]) {
        byDebitCounterparty[pairKey] = { count: 0, total: 0, amounts: [], accountName, counterpartyName };
      }
      byDebitCounterparty[pairKey].count++;
      byDebitCounterparty[pairKey].total += amount;
      byDebitCounterparty[pairKey].amounts.push(amount);
    }

    const sortedByAccount = Object.entries(byDebitAccount)
      .map(([name, v]) => ({ accountName: name, ...v }))
      .sort((a, b) => b.total - a.total);

    const sortedByCounterparty = Object.entries(byCounterparty)
      .map(([name, v]) => ({ counterpartyName: name, count: v.count, total: v.total, accountCount: v.accounts.size, accountNames: Array.from(v.accounts).slice(0, 5) }))
      .sort((a, b) => b.total - a.total);

    // 繰り返しパターン（同じ借方科目+取引先で複数回）
    const repeatedPatterns = Object.values(byDebitCounterparty)
      .filter((p) => p.count >= 2 && p.counterpartyName !== "(取引先なし)")
      .map((p) => ({
        accountName: p.accountName,
        counterpartyName: p.counterpartyName,
        count: p.count,
        total: p.total,
        avgAmount: Math.round(p.total / p.count),
        minAmount: Math.min(...p.amounts),
        maxAmount: Math.max(...p.amounts),
        // 金額の変動係数（標準偏差/平均）で定額/従量判定
        isFixed: Math.max(...p.amounts) - Math.min(...p.amounts) <= p.total / p.count * 0.1,
      }))
      .sort((a, b) => b.total - a.total);

    return NextResponse.json({
      ok: true,
      period: { from, to },
      filter: { debitKeyword, creditKeyword },
      summary: {
        filteredCount: filtered.length,
        totalAmount: filtered.reduce(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (s: number, j: any) => s + (j.branches || []).reduce((bs: number, b: any) => bs + (b.debitor?.value || 0), 0),
          0,
        ),
      },
      byDebitAccount: sortedByAccount,
      byCounterparty: sortedByCounterparty.slice(0, 30),
      repeatedPatterns: repeatedPatterns.slice(0, 30),
      // サンプル詳細（上位20件）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      samples: (filtered as any[]).slice(0, 20).map((j) => {
        const branches = j.branches || [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const firstDebit = branches.find((b: any) => b?.debitor?.account_id != null) as any;
        const debitAccountName = firstDebit?.debitor?.account_id != null ? accountIdToName.get(firstDebit.debitor.account_id as number) || "" : "";
        const counterpartyId = firstDebit?.debitor?.counterparty_id as number | undefined;
        const counterpartyName = counterpartyId ? (counterpartyIdToName.get(counterpartyId) || `cpid=${counterpartyId}`) : "";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const amount = branches.reduce((s: number, b: any) => s + (b.debitor?.value || 0), 0);
        return {
          id: j.id,
          date: j.transaction_date,
          debitAccount: debitAccountName,
          counterparty: counterpartyName,
          amount,
          memo: (j.memo || "").slice(0, 100),
        };
      }),
    });
  } catch (e) {
    console.error("[analyze-journal-detail] Error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
