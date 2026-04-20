import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/api-auth";
import { getJournals, getAccounts } from "@/lib/mf-accounting";

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
  isOutOfScope: boolean; // true なら購買管理の範囲外（経理直接/財務/税務等）
  refNumber: string | null;
  debitAccount: string;
  creditAccount: string;
  amount: number;
  memo: string;
  remark: string;
  journalType: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyJournal(journal: any, accountIdToName: Map<number, string>): ClassifiedJournal {
  const branches = journal.branches || [];
  // 多行仕訳対応: 最初に account_id が非nullの借方/貸方を採用
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const firstDebitBranch = branches.find((b: any) => b?.debitor?.account_id != null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const firstCreditBranch = branches.find((b: any) => b?.creditor?.account_id != null);
  const firstBranch = branches[0];
  const debitId = firstDebitBranch?.debitor?.account_id;
  const creditId = firstCreditBranch?.creditor?.account_id;
  const debitAccount = debitId != null ? (accountIdToName.get(debitId) || `account_id=${debitId}`) : "";
  const creditAccount = creditId != null ? (accountIdToName.get(creditId) || `account_id=${creditId}`) : "";
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
      isOutOfScope: true,
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

  // ===== STEP 1: 購買管理システムの対象外を先に除外 =====
  // 資金移動・消込・決算調整等は経理が直接処理するもの。購買管理の対象ではない。
  const outOfScopeRules: Array<{ match: (d: string, c: string) => boolean; type: string; flow: string }> = [
    // 売上・収益（貸方が売掛金・売上）
    { match: (d, c) => d.includes("普通預金") && c.includes("売掛金"), type: "範囲外/売上入金", flow: "対象外(経理直接)" },
    { match: (d, c) => d.includes("売掛金"), type: "範囲外/売上計上", flow: "対象外(経理直接)" },
    { match: (d, _c) => d.includes("売上") && !d.includes("売上原価"), type: "範囲外/売上", flow: "対象外(経理直接)" },
    { match: (_d, c) => c.includes("受取利息") || c.includes("雑収入") || c.includes("営業外収益"), type: "範囲外/収益", flow: "対象外(経理直接)" },
    { match: (_d, c) => c.includes("売上高"), type: "範囲外/売上計上", flow: "対象外(経理直接)" },
    // 契約負債・前受金（収益認識）
    { match: (d, _c) => d.includes("契約負債") || d.includes("前受"), type: "範囲外/契約負債取崩", flow: "対象外(経理直接)" },
    { match: (_d, c) => c.includes("契約負債") || c.includes("前受"), type: "範囲外/前受金計上", flow: "対象外(経理直接)" },
    // 支払・消込（Stage3自動処理 or 経理直接）
    { match: (d, c) => d.includes("未払金") && c.includes("普通預金"), type: "範囲外/支払消込", flow: "対象外(Stage3自動 or 経理直接)" },
    { match: (d, c) => d.includes("買掛金") && c.includes("普通預金"), type: "範囲外/買掛金支払", flow: "対象外(Stage3自動 or 経理直接)" },
    { match: (d, c) => d.includes("未払金") && c.includes("現金"), type: "範囲外/現金支払", flow: "対象外(経理直接)" },
    // 未払費用の支払・洗替（期末・期首の調整）
    { match: (d, c) => d.includes("未払費用") && (c.includes("普通預金") || c.includes("現金")), type: "範囲外/未払費用支払", flow: "対象外(経理直接)" },
    { match: (d, _c) => d.includes("未払費用"), type: "範囲外/未払費用調整", flow: "対象外(決算/経理直接)" },
    // NOTE: 貸方=未払費用のルールは STEP 2 で借方科目を判定した後に適用
    // （借方が旅費交通費・消耗品費等の費用科目なら対象内のStage1仕訳として処理可能）
    // 借入金・財務
    { match: (d, _c) => d.includes("借入金") || d.includes("返済"), type: "範囲外/借入返済", flow: "対象外(財務)" },
    { match: (d, _c) => d.includes("支払利息") || d.includes("利息費用"), type: "範囲外/支払利息", flow: "対象外(財務)" },
    { match: (_d, c) => c.includes("借入金"), type: "範囲外/借入金受入", flow: "対象外(財務)" },
    { match: (_d, c) => c.includes("資産除去債務") || c.includes("社債"), type: "範囲外/長期負債", flow: "対象外(財務)" },
    // 税務・源泉
    { match: (d, c) => d.includes("預り金") && c.includes("普通預金"), type: "範囲外/源泉税等納付", flow: "対象外(税務)" },
    { match: (_d, c) => c.includes("預り金"), type: "範囲外/預り金発生", flow: "対象外(給与/税務)" },
    // 決算調整・繰延
    { match: (d, _c) => d.includes("前払費用") || d.includes("長期前払費用"), type: "範囲外/前払費用", flow: "対象外(決算)" },
    { match: (_d, c) => c.includes("前払費用") || c.includes("長期前払費用"), type: "範囲外/前払費用洗替", flow: "対象外(決算)" },
    { match: (d, _c) => d.includes("仮払") || d.includes("仮受"), type: "範囲外/仮勘定", flow: "対象外(経理直接)" },
    // 資金移動
    { match: (d, c) => d.includes("普通預金") && c.includes("普通預金"), type: "範囲外/資金移動", flow: "対象外(経理直接)" },
    { match: (d, c) => (d.includes("現金") && c.includes("普通預金")) || (d.includes("普通預金") && c.includes("現金")), type: "範囲外/現金預金移動", flow: "対象外(経理直接)" },
    // 振替仕訳
    { match: (d, c) => d.includes("立替金") && c.includes("普通預金"), type: "範囲外/立替金精算", flow: "対象外(経理直接)" },
  ];

  for (const rule of outOfScopeRules) {
    if (rule.match(debitAccount, creditAccount)) {
      return {
        id: journal.id,
        date: journal.transaction_date,
        type: rule.type,
        flow: rule.flow,
        canHandle: false,
        isOutOfScope: true,
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

  // ===== STEP 2: 購買管理システムで扱える仕訳を分類 =====
  // 部分一致で製造業の (製) (変) (固) サフィックス付きにも対応
  const rules: Array<{ keywords: string[]; type: string; flow: string }> = [
    { keywords: ["消耗品費", "事務用品"], type: "物品購買", flow: "purchaseFlow" },
    { keywords: ["工具器具備品", "備品"], type: "物品購買(固定資産)", flow: "purchaseFlow+固定資産登録" },
    { keywords: ["旅費交通費", "交通費"], type: "出張/旅費", flow: "tripFlow or 立替" },
    // 製造業: 外注加工費(変)/(固)も拾えるよう「外注」「加工費」「業務委託」で拡張
    { keywords: ["外注", "加工費", "業務委託"], type: "役務/外注", flow: "serviceFlow or contractFlow" },
    { keywords: ["派遣"], type: "役務/派遣", flow: "contractFlow(従量)" },
    { keywords: ["支払報酬料", "顧問料"], type: "役務/顧問", flow: "contractFlow(固定)" },
    { keywords: ["地代家賃", "賃借料", "リース料"], type: "契約/賃貸", flow: "contractFlow(固定)" },
    { keywords: ["通信費", "サーバー費", "クラウド", "ライセンス費", "ライセンス料"], type: "通信/SaaS", flow: "contractFlow(固定/カード自動)" },
    { keywords: ["水道光熱費", "電気料", "ガス料", "水道料"], type: "光熱費", flow: "contractFlow(固定)" },
    { keywords: ["支払手数料"], type: "SaaS/手数料", flow: "contractFlow or purchaseFlow" },
    { keywords: ["会議費"], type: "会議費", flow: "purchaseFlow or 立替" },
    { keywords: ["接待交際費"], type: "交際費", flow: "立替 or purchaseFlow" },
    { keywords: ["新聞図書費", "図書研究費", "図書費"], type: "書籍/購読", flow: "purchaseFlow or contractFlow" },
    { keywords: ["修繕費", "保守料"], type: "保守/修繕", flow: "contractFlow(固定) or serviceFlow" },
    { keywords: ["福利厚生費", "厚生費"], type: "福利厚生", flow: "purchaseFlow or 立替" },
    { keywords: ["広告宣伝費", "広告費"], type: "広告", flow: "purchaseFlow or contractFlow" },
    { keywords: ["研修費", "教育費"], type: "研修", flow: "serviceFlow or purchaseFlow" },
    { keywords: ["採用費"], type: "採用", flow: "contractFlow(広告) or purchaseFlow" },
    { keywords: ["研究開発費"], type: "研究開発", flow: "purchaseFlow or serviceFlow" },
    // 製造業: 材料仕入高(製)等
    { keywords: ["材料仕入高", "材料費"], type: "製造/材料仕入", flow: "purchaseFlow(製造) or 別システム" },
    { keywords: ["仕入高", "商品仕入"], type: "商品仕入", flow: "purchaseFlow(仕入) or 別システム" },
    { keywords: ["車両費", "ガソリン"], type: "車両費", flow: "purchaseFlow or 立替" },
    { keywords: ["荷造運賃", "運送費", "発送費", "発送配達費", "配達費"], type: "配送費", flow: "purchaseFlow" },
    { keywords: ["消耗工具器具備品"], type: "消耗工具", flow: "purchaseFlow" },
    { keywords: ["租税公課"], type: "範囲外/税金", flow: "対象外(経理直接)" },
    { keywords: ["給料", "役員報酬", "給与手当", "賞与"], type: "範囲外/給与", flow: "対象外(MF給与)" },
    { keywords: ["法定福利費"], type: "範囲外/社会保険", flow: "対象外(MF給与)" },
    { keywords: ["減価償却費"], type: "範囲外/償却", flow: "対象外(MF固定資産)" },
    { keywords: ["貸倒引当金", "引当金"], type: "範囲外/引当金", flow: "対象外(決算)" },
    { keywords: ["雑費", "雑損失"], type: "雑費", flow: "purchaseFlow(他に該当なしの場合)" },
  ];

  for (const rule of rules) {
    if (rule.keywords.some((k) => debitAccount.includes(k))) {
      const isReimbursement = (creditAccount.includes("未払金") || creditAccount.includes("立替"))
        && (memo.includes("立替") || remark.includes("立替"));
      const isAccrual = creditAccount.includes("未払費用"); // 月末計上タイミング
      const isOutOfScope = rule.flow.startsWith("対象外");
      return {
        id: journal.id,
        date: journal.transaction_date,
        type: isReimbursement ? `${rule.type}(立替)` : isAccrual ? `${rule.type}(月末計上)` : rule.type,
        flow: isReimbursement ? "expenseFlow" : rule.flow,
        canHandle: !isOutOfScope,
        isOutOfScope,
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

  // ===== STEP 3: 借方で分類できなかったが、貸方=未払費用なら月末計上仕訳として範囲外 =====
  if (creditAccount.includes("未払費用")) {
    return {
      id: journal.id,
      date: journal.transaction_date,
      type: "範囲外/未払費用計上(借方不明)",
      flow: "対象外(決算)",
      canHandle: false,
      isOutOfScope: true,
      refNumber,
      debitAccount,
      creditAccount,
      amount,
      memo: memo.slice(0, 150),
      remark: remark.slice(0, 150),
      journalType: journal.journal_type,
    };
  }

  return {
    id: journal.id,
    date: journal.transaction_date,
    type: "未分類",
    flow: "要ルール追加",
    canHandle: false,
    isOutOfScope: false,
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

    // 勘定科目マスタを取得して ID → 名前 lookup テーブルを構築
    const accounts = await getAccounts();
    const accountIdToName = new Map<number, string>();
    for (const a of accounts) {
      accountIdToName.set(a.id, a.name);
    }

    const journals = await getJournals({ from, to });
    const results = journals.map((j) => classifyJournal(j, accountIdToName));

    const regular = results.filter((r) => r.journalType !== "adjusting_entry");
    const adjusting = results.filter((r) => r.journalType === "adjusting_entry");

    // 購買管理の「対象内」のみを対象にカバー率計算
    const outOfScope = regular.filter((r) => r.isOutOfScope);
    const inScope = regular.filter((r) => !r.isOutOfScope);
    const handled = inScope.filter((r) => r.canHandle);
    const unclassified = inScope.filter((r) => !r.canHandle); // 未分類のみ

    const totalAmount = regular.reduce((s, r) => s + r.amount, 0);
    const inScopeAmount = inScope.reduce((s, r) => s + r.amount, 0);
    const handledAmount = handled.reduce((s, r) => s + r.amount, 0);
    const outOfScopeAmount = outOfScope.reduce((s, r) => s + r.amount, 0);

    // 種別集計
    const typeSummary: Record<string, { count: number; totalAmount: number; canHandle: boolean; isOutOfScope: boolean; flow: string }> = {};
    for (const r of regular) {
      const key = r.type;
      if (!typeSummary[key]) {
        typeSummary[key] = { count: 0, totalAmount: 0, canHandle: r.canHandle, isOutOfScope: r.isOutOfScope, flow: r.flow };
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
        inScopeCount: inScope.length,
        outOfScopeCount: outOfScope.length,
        handledCount: handled.length,
        unclassifiedCount: unclassified.length,
        totalAmount,
        inScopeAmount,
        outOfScopeAmount,
        handledAmount,
        unclassifiedAmount: inScopeAmount - handledAmount,
        // 購買管理対象内でのカバー率
        coverageRate: inScope.length > 0 ? (handled.length / inScope.length) * 100 : 0,
        coverageRateByAmount: inScopeAmount > 0 ? (handledAmount / inScopeAmount) * 100 : 0,
      },
      typeBreakdown: sortedTypes,
      // 未分類のみをサンプルとして返す（対象外は「想定通り」なので除外）
      notHandledSamples: unclassified.slice(0, 20).map((r) => ({
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
