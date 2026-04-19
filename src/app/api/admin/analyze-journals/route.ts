import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/api-auth";
import { getJournals } from "@/lib/mf-accounting";

/**
 * 新システムの対応範囲分析:
 * MF会計Plusから対象月の通常仕訳を取得し、新システムでどのフローで再現可能かを分類
 *
 * GET /api/admin/analyze-journals?month=YYYY-MM
 *
 * 返却: サマリ（件数・金額・カバー率）+ 種別内訳 + 未分類サンプル
 */

interface ClassifiedJournal {
  id: number;
  date: string;
  type: string;
  flow: string;
  canHandle: boolean;
  refNumber: string | null;
  debitAccount: string;
  creditAccount: string;
  amount: number;
  memo: string;
  remark: string;
  journalType: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyJournal(journal: any): ClassifiedJournal {
  const branches = journal.branches || [];
  const debitAccount = branches[0]?.debitor?.account_name || "";
  const creditAccount = branches[0]?.creditor?.account_name || "";
  const memo = journal.memo || "";
  const remark = branches[0]?.remark || "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const amount = branches.reduce((s: number, b: any) => s + (b.debitor?.value || 0), 0);

  // 決算整理仕訳は分析対象外
  if (journal.journal_type === "adjusting_entry") {
    return {
      id: journal.id,
      date: journal.transaction_date,
      type: "決算整理",
      flow: "対象外",
      canHandle: false,
      refNumber: null,
      debitAccount,
      creditAccount,
      amount,
      memo: memo.slice(0, 150),
      remark: remark.slice(0, 150),
      journalType: journal.journal_type,
    };
  }

  // PO/契約番号の抽出
  const ref = (memo + " " + remark).match(/(PO-\d{4,6}-\d{4}|PR-\d{4}|CT-\d{6,8}-\d{4}|TRIP-\d{6,8}-\d{4})/);
  const refNumber = ref?.[1] || null;

  const rules: Array<{ keywords: string[]; type: string; flow: string }> = [
    { keywords: ["消耗品費", "事務用品費"], type: "物品購買", flow: "purchaseFlow" },
    { keywords: ["工具器具備品", "備品"], type: "物品購買(固定資産)", flow: "purchaseFlow+固定資産登録" },
    { keywords: ["旅費交通費", "交通費"], type: "出張/旅費", flow: "tripFlow or 立替" },
    { keywords: ["外注費", "業務委託費"], type: "役務/外注", flow: "serviceFlow or contractFlow" },
    { keywords: ["派遣料", "派遣費"], type: "役務/派遣", flow: "contractFlow(従量)" },
    { keywords: ["支払報酬料", "顧問料"], type: "役務/顧問", flow: "contractFlow(固定)" },
    { keywords: ["地代家賃", "賃借料"], type: "契約/賃貸", flow: "contractFlow(固定)" },
    { keywords: ["通信費"], type: "通信/SaaS", flow: "contractFlow(固定/カード自動)" },
    { keywords: ["水道光熱費", "電気料", "ガス料", "水道料"], type: "光熱費", flow: "contractFlow(固定)" },
    { keywords: ["支払手数料"], type: "SaaS/手数料", flow: "contractFlow or purchaseFlow" },
    { keywords: ["会議費"], type: "会議費", flow: "purchaseFlow or 立替" },
    { keywords: ["接待交際費"], type: "交際費", flow: "立替 or purchaseFlow" },
    { keywords: ["新聞図書費"], type: "書籍/購読", flow: "purchaseFlow or contractFlow" },
    { keywords: ["修繕費", "保守料"], type: "保守/修繕", flow: "contractFlow(固定) or serviceFlow" },
    { keywords: ["福利厚生費"], type: "福利厚生", flow: "purchaseFlow or 立替" },
    { keywords: ["広告宣伝費"], type: "広告", flow: "purchaseFlow or contractFlow" },
    { keywords: ["研修費", "教育費"], type: "研修", flow: "serviceFlow or purchaseFlow" },
    { keywords: ["租税公課"], type: "税金", flow: "対象外(経理直接)" },
    { keywords: ["給料", "役員報酬", "給与手当"], type: "給与", flow: "対象外(MF給与)" },
    { keywords: ["法定福利費"], type: "社会保険", flow: "対象外(MF給与)" },
    { keywords: ["減価償却費"], type: "償却", flow: "対象外(MF固定資産)" },
    { keywords: ["雑費"], type: "雑費", flow: "purchaseFlow(他に該当なしの場合)" },
  ];

  for (const rule of rules) {
    if (rule.keywords.some((k) => debitAccount.includes(k))) {
      const isReimbursement = (creditAccount.includes("未払金") || creditAccount.includes("立替"))
        && (memo.includes("立替") || remark.includes("立替"));
      return {
        id: journal.id,
        date: journal.transaction_date,
        type: isReimbursement ? `${rule.type}(立替)` : rule.type,
        flow: isReimbursement ? "expenseFlow" : rule.flow,
        canHandle: !rule.flow.startsWith("対象外"),
        refNumber,
        debitAccount,
        creditAccount,
        amount,
        memo: memo.slice(0, 150),
        remark: remark.slice(0, 150),
        journalType: journal.journal_type,
      };
    }
  }

  return {
    id: journal.id,
    date: journal.transaction_date,
    type: "未分類",
    flow: "要ルール追加",
    canHandle: false,
    refNumber,
    debitAccount,
    creditAccount,
    amount,
    memo: memo.slice(0, 150),
    remark: remark.slice(0, 150),
    journalType: journal.journal_type,
  };
}

export async function GET(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const month = request.nextUrl.searchParams.get("month") || new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "month は YYYY-MM 形式で指定" }, { status: 400 });
    }

    const [yStr, mStr] = month.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    const from = `${yStr}-${mStr}-01`;
    const to = new Date(y, m, 0).toISOString().split("T")[0];

    const journals = await getJournals({ from, to });
    const results = journals.map((j) => classifyJournal(j));

    const regular = results.filter((r) => r.journalType !== "adjusting_entry");
    const adjusting = results.filter((r) => r.journalType === "adjusting_entry");
    const handled = regular.filter((r) => r.canHandle);
    const notHandled = regular.filter((r) => !r.canHandle);

    const totalAmount = regular.reduce((s, r) => s + r.amount, 0);
    const handledAmount = handled.reduce((s, r) => s + r.amount, 0);

    // 種別集計
    const typeSummary: Record<string, { count: number; totalAmount: number; canHandle: boolean; flow: string }> = {};
    for (const r of regular) {
      const key = r.type;
      if (!typeSummary[key]) {
        typeSummary[key] = { count: 0, totalAmount: 0, canHandle: r.canHandle, flow: r.flow };
      }
      typeSummary[key].count++;
      typeSummary[key].totalAmount += r.amount;
    }
    const sortedTypes = Object.entries(typeSummary)
      .sort((a, b) => b[1].totalAmount - a[1].totalAmount)
      .map(([type, data]) => ({ type, ...data }));

    return NextResponse.json({
      ok: true,
      period: { from, to },
      summary: {
        totalJournals: results.length,
        regularJournals: regular.length,
        adjustingEntries: adjusting.length,
        handledCount: handled.length,
        notHandledCount: notHandled.length,
        totalAmount,
        handledAmount,
        notHandledAmount: totalAmount - handledAmount,
        coverageRate: regular.length > 0 ? (handled.length / regular.length) * 100 : 0,
        coverageRateByAmount: totalAmount > 0 ? (handledAmount / totalAmount) * 100 : 0,
      },
      typeBreakdown: sortedTypes,
      notHandledSamples: notHandled.slice(0, 20).map((r) => ({
        id: r.id,
        date: r.date,
        type: r.type,
        debitAccount: r.debitAccount,
        creditAccount: r.creditAccount,
        amount: r.amount,
        memo: r.memo,
      })),
    });
  } catch (e) {
    console.error("[analyze-journals] Error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
