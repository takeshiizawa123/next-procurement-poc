import { NextRequest, NextResponse } from "next/server";
import {
  getJournals,
  createJournal,
  resolveAccountCode,
  resolveSubAccountCode,
} from "@/lib/mf-accounting";
import { getEmployeeCards } from "@/lib/gas-client";
import { requireBearerAuth } from "@/lib/api-auth";

/**
 * 引落照合API — 未払金(請求)集計 + Stage 3仕訳作成（認証必須）
 * POST /api/admin/card-matching/withdrawal
 *
 * Body: { month: string, action?: "query" | "confirm", withdrawalDate?: string }
 *
 * action="query"（デフォルト）:
 *   MF会計Plusから対象月の未払金(MFカード:請求)仕訳を集計し、カード別の内訳を返す。
 *
 * action="confirm":
 *   Stage 3仕訳を作成（借: 未払金:MFカード:請求 → 貸: 普通預金）。
 *   withdrawalDate: 引落日（YYYY-MM-DD）
 */
export async function POST(request: NextRequest) {
  const authError = requireBearerAuth(request);
  if (authError) return authError;

  try {
    const body = (await request.json()) as {
      month: string;
      action?: "query" | "confirm";
      withdrawalDate?: string;
      withdrawalAmount?: number;
    };

    const { month, action = "query" } = body;

    if (!month) {
      return NextResponse.json(
        { error: "month が必要です（例: 2026-03）" },
        { status: 400 },
      );
    }

    const [y, m] = month.split("-").map(Number);
    const from = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const to = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    console.log(`[withdrawal] Fetching unpaid journals: ${from} ~ ${to}`);

    // MF会計Plus仕訳取得 + 従業員カード情報を並列取得
    const [journals, empRes] = await Promise.all([
      getJournals({ from, to }).catch(() => []),
      getEmployeeCards(),
    ]);

    const employeeCards = empRes.success ? (empRes.data?.employees || []) : [];

    // 未払金(MFカード:請求) の仕訳を抽出
    const unpaidJournals = journals.filter((j) => {
      const branch = j.branches[0];
      if (!branch) return false;
      const creditorName = branch.creditor.account_name || "";
      const creditorSub = branch.creditor.sub_account_name || "";
      return (
        creditorName.includes("未払金") &&
        (creditorSub.includes("請求") || creditorSub.includes("カード"))
      );
    });

    // カード別に集計
    const cardBreakdown = new Map<string, { label: string; amount: number; count: number }>();

    for (const j of unpaidJournals) {
      const branch = j.branches[0];
      if (!branch) continue;

      const amount = branch.creditor.value;
      const remark = branch.remark || j.memo || "";

      const cardMatch = remark.match(/[*＊](\d{4})\s/) || remark.match(/カード番号[:：]?\s*(\d{4})/);
      const cardLast4 = cardMatch ? cardMatch[1] : "unknown";

      const emp = employeeCards.find((e) => e.card_last4 === cardLast4);
      const label = emp
        ? `従業員カード（${emp.name}）`
        : cardLast4 === "unknown"
          ? "カード不明"
          : `カード *${cardLast4}`;

      const key = cardLast4;
      const existing = cardBreakdown.get(key);
      if (existing) {
        existing.amount += amount;
        existing.count += 1;
      } else {
        cardBreakdown.set(key, { label, amount, count: 1 });
      }
    }

    const unpaidBreakdown = Array.from(cardBreakdown.values()).sort(
      (a, b) => b.amount - a.amount,
    );
    const unpaidTotal = unpaidBreakdown.reduce((s, b) => s + b.amount, 0);
    const usageMonth = `${y}年${m}月`;

    console.log(
      `[withdrawal] unpaidTotal=${unpaidTotal}, breakdown=${unpaidBreakdown.length}cards, journals=${unpaidJournals.length}`,
    );

    // --- action="confirm": Stage 3 仕訳を作成 ---
    if (action === "confirm") {
      const { withdrawalDate, withdrawalAmount } = body;
      if (!withdrawalDate) {
        return NextResponse.json(
          { error: "withdrawalDate が必要です（YYYY-MM-DD）" },
          { status: 400 },
        );
      }

      const amount = withdrawalAmount || unpaidTotal;
      if (amount <= 0) {
        return NextResponse.json(
          { error: "引落額が0です。仕訳を作成する必要がありません。" },
          { status: 400 },
        );
      }

      // Stage 3 仕訳: 借: 未払金:MFカード:請求 → 貸: 普通預金
      const unpaidCode = await resolveAccountCode("未払金") || "未払金";
      const bankCode = await resolveAccountCode("普通預金") || "普通預金";
      const subBilledCode = await resolveSubAccountCode("未払金", "MFカード:請求");

      const stage3Journal = await createJournal({
        status: "draft",
        transaction_date: withdrawalDate,
        journal_type: "journal_entry",
        tags: [month, "Stage3"],
        memo: `${usageMonth}分 MFカード引落 Stage3`,
        branches: [
          {
            remark: `${usageMonth}分 MFビジネスカード引落（未払金消込）`,
            debitor: {
              account_code: unpaidCode,
              ...(subBilledCode ? { sub_account_code: subBilledCode } : {}),
              value: amount,
            },
            creditor: {
              account_code: bankCode,
              value: amount,
            },
          },
        ],
      });

      console.log(
        `[withdrawal] Stage 3 journal created: ${stage3Journal.id} — ` +
        `${usageMonth}分 ¥${amount.toLocaleString()}`,
      );

      return NextResponse.json({
        ok: true,
        action: "confirm",
        usageMonth,
        withdrawalDate,
        amount,
        stage3JournalId: stage3Journal.id,
        unpaidTotal,
        diff: unpaidTotal - amount,
      });
    }

    // --- action="query": 集計結果を返す ---
    return NextResponse.json({
      ok: true,
      action: "query",
      usageMonth,
      unpaidTotal,
      unpaidBreakdown,
      journalCount: unpaidJournals.length,
    });
  } catch (error) {
    console.error("[withdrawal] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
