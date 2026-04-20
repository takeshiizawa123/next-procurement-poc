import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/api-auth";
import { getJournals, getAccounts, getCounterparties } from "@/lib/mf-accounting";

/**
 * 継続契約化候補の自動抽出
 * GET /api/admin/contract-candidates?from=YYYY-MM&to=YYYY-MM
 *
 * 複数月のMF仕訳を取得し、(借方科目 × 取引先) のペアが期間内で
 * 繰り返し発生しているものを継続契約候補として抽出する。
 *
 * 判定:
 * - 発生月数 >= 対象月数の2/3以上 → 継続契約候補
 * - 金額変動係数 <= 0.1 → 固定（月額一定）
 * - それ以外 → 従量
 * - 借方科目 → カテゴリ推測（地代家賃→賃貸、通信費→SaaS等）
 */

type Category = "派遣" | "外注" | "SaaS" | "顧問" | "賃貸" | "保守" | "清掃" | "その他";
type BillingType = "固定" | "従量" | "カード自動";

function guessCategory(accountName: string): Category {
  if (accountName.includes("地代家賃") || accountName.includes("賃借料") || accountName.includes("リース")) return "賃貸";
  if (accountName.includes("派遣")) return "派遣";
  if (accountName.includes("外注") || accountName.includes("業務委託") || accountName.includes("加工費")) return "外注";
  if (accountName.includes("通信") || accountName.includes("サーバー") || accountName.includes("クラウド") || accountName.includes("ライセンス")) return "SaaS";
  if (accountName.includes("顧問料") || accountName.includes("支払報酬")) return "顧問";
  if (accountName.includes("保守") || accountName.includes("修繕")) return "保守";
  if (accountName.includes("清掃")) return "清掃";
  if (accountName.includes("支払手数料")) return "SaaS";
  return "その他";
}

function guessAccountTitle(accountName: string): string {
  // サフィックス除去 (製) (変) (固)
  return accountName.replace(/\([製変固].*?\)/g, "").trim();
}

function monthsBetween(from: string, to: string): string[] {
  // from/to: "YYYY-MM"
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const months: string[] = [];
  for (let y = fy; y <= ty; y++) {
    const sm = y === fy ? fm : 1;
    const em = y === ty ? tm : 12;
    for (let m = sm; m <= em; m++) {
      months.push(`${y}-${String(m).padStart(2, "0")}`);
    }
  }
  return months;
}

export async function GET(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const from = request.nextUrl.searchParams.get("from");
    const to = request.nextUrl.searchParams.get("to");
    if (!from || !to || !/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: "from/to は YYYY-MM 形式で指定" }, { status: 400 });
    }

    const months = monthsBetween(from, to);
    if (months.length === 0) return NextResponse.json({ error: "期間が不正" }, { status: 400 });
    if (months.length > 12) return NextResponse.json({ error: "期間は12ヶ月以内" }, { status: 400 });

    // 期間計算
    const [fy, fm] = from.split("-").map(Number);
    const [ty, tm] = to.split("-").map(Number);
    const fromDate = `${fy}-${String(fm).padStart(2, "0")}-01`;
    const toDate = new Date(ty, tm, 0).toISOString().split("T")[0];

    // マスタ
    const [accounts, counterparties] = await Promise.all([getAccounts(), getCounterparties()]);
    const accountIdToName = new Map<number, string>();
    for (const a of accounts) accountIdToName.set(a.id, a.name);
    const counterpartyIdToName = new Map<number, string>();
    for (const c of counterparties) counterpartyIdToName.set(c.id, c.name);

    // 全仕訳取得（通常仕訳のみ）
    const allJournals = await getJournals({ from: fromDate, to: toDate });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const regularJournals = allJournals.filter((j: any) => j.journal_type !== "adjusting_entry");

    // (accountId × counterpartyId) で集計（月ごと）
    interface Pattern {
      accountId: number;
      accountName: string;
      counterpartyId: number;
      counterpartyName: string;
      monthlyData: Map<string, { count: number; total: number; amounts: number[] }>;
    }
    const patterns = new Map<string, Pattern>();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const j of regularJournals as any[]) {
      const branches = j.branches || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const firstDebit = branches.find((b: any) => b?.debitor?.account_id != null) as any;
      if (!firstDebit) continue;
      const accountId = firstDebit.debitor.account_id as number;
      const counterpartyId = firstDebit.debitor.counterparty_id as number | undefined;
      if (!counterpartyId) continue; // 取引先なしは候補にしない

      const accountName = accountIdToName.get(accountId) || `account_id=${accountId}`;
      const counterpartyName = counterpartyIdToName.get(counterpartyId) || `cpid=${counterpartyId}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const amount = branches.reduce((s: number, b: any) => s + (b.debitor?.value || 0), 0);
      const month = (j.transaction_date as string).slice(0, 7);

      // 範囲外カテゴリの借方は除外（売上・財務・税務等）
      if (
        accountName.includes("売掛金") ||
        accountName.includes("売上") ||
        accountName.includes("借入金") ||
        accountName.includes("支払利息") ||
        accountName.includes("預り金") ||
        accountName.includes("前払費用") ||
        accountName.includes("未払費用") ||
        accountName.includes("未払金") ||
        accountName.includes("普通預金") ||
        accountName.includes("現金") ||
        accountName.includes("仮払") ||
        accountName.includes("仮受") ||
        accountName.includes("租税公課") ||
        accountName.includes("役員報酬") ||
        accountName.includes("給料") ||
        accountName.includes("給与") ||
        accountName.includes("賞与") ||
        accountName.includes("法定福利") ||
        accountName.includes("減価償却")
      ) continue;

      const key = `${accountId}|${counterpartyId}`;
      let p = patterns.get(key);
      if (!p) {
        p = {
          accountId,
          accountName,
          counterpartyId,
          counterpartyName,
          monthlyData: new Map(),
        };
        patterns.set(key, p);
      }

      let md = p.monthlyData.get(month);
      if (!md) {
        md = { count: 0, total: 0, amounts: [] };
        p.monthlyData.set(month, md);
      }
      md.count++;
      md.total += amount;
      md.amounts.push(amount);
    }

    // 継続契約候補の判定
    const threshold = Math.ceil(months.length * 2 / 3); // 2/3以上の月で発生
    const candidates: Array<{
      accountId: number;
      accountName: string;
      counterpartyId: number;
      counterpartyName: string;
      monthsActive: number;
      totalMonths: number;
      monthlyAmounts: Array<{ month: string; amount: number; count: number }>;
      avgMonthlyAmount: number;
      minAmount: number;
      maxAmount: number;
      variationPct: number; // 金額変動率 (max-min)/avg
      billingType: BillingType;
      category: Category;
      accountTitle: string;
      totalAmount: number;
    }> = [];

    for (const p of patterns.values()) {
      const monthsActive = p.monthlyData.size;
      if (monthsActive < threshold) continue;

      const monthlyAmounts = Array.from(p.monthlyData.entries())
        .map(([month, data]) => ({ month, amount: data.total, count: data.count }))
        .sort((a, b) => a.month.localeCompare(b.month));
      const totalAmount = monthlyAmounts.reduce((s, m) => s + m.amount, 0);
      const avgMonthlyAmount = Math.round(totalAmount / monthsActive);
      const amounts = monthlyAmounts.map((m) => m.amount);
      const minAmount = Math.min(...amounts);
      const maxAmount = Math.max(...amounts);
      const variationPct = avgMonthlyAmount > 0 ? ((maxAmount - minAmount) / avgMonthlyAmount) : 0;

      // 金額変動が10%以内なら固定、それ以外は従量
      const billingType: BillingType = variationPct <= 0.1 ? "固定" : "従量";

      candidates.push({
        accountId: p.accountId,
        accountName: p.accountName,
        counterpartyId: p.counterpartyId,
        counterpartyName: p.counterpartyName,
        monthsActive,
        totalMonths: months.length,
        monthlyAmounts,
        avgMonthlyAmount,
        minAmount,
        maxAmount,
        variationPct: Math.round(variationPct * 1000) / 10, // %表示
        billingType,
        category: guessCategory(p.accountName),
        accountTitle: guessAccountTitle(p.accountName),
        totalAmount,
      });
    }

    candidates.sort((a, b) => b.totalAmount - a.totalAmount);

    return NextResponse.json({
      ok: true,
      period: { from, to, months: months.length },
      threshold: { monthsRequired: threshold },
      totalPatterns: patterns.size,
      candidates,
    });
  } catch (e) {
    console.error("[contract-candidates] Error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
