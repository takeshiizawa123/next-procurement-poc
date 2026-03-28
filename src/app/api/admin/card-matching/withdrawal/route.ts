import { NextRequest, NextResponse } from "next/server";
import { getJournals } from "@/lib/mf-accounting";
import { getEmployeeCards } from "@/lib/gas-client";
import { requireBearerAuth } from "@/lib/api-auth";

/**
 * 引落照合API — 未払金(請求)集計（認証必須）
 * POST /api/admin/card-matching/withdrawal
 *
 * Body: { month: string }  // "2026-03" = 利用月（引落は翌月）
 *
 * MF会計Plusから対象月の未払金(MFカード:請求)仕訳を集計し、
 * カード別の内訳を返す。フロントはCSVの引落額と突合する。
 */
export async function POST(request: NextRequest) {
  const authError = requireBearerAuth(request);
  if (authError) return authError;

  try {
    const { month } = (await request.json()) as { month: string };

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
    // 借方が未払金(請求)の場合 = Stage 2（カード明細由来の自動仕訳）
    // 貸方が未払金(請求)の場合 = 引落仕訳（銀行引落）
    // ここでは借方に未払金が立つ仕訳（= カード利用の計上）を集計
    const unpaidJournals = journals.filter((j) => {
      const branch = j.branches[0];
      if (!branch) return false;
      const creditorName = branch.creditor.account_name || "";
      const creditorSub = branch.creditor.sub_account_name || "";
      // 貸方が未払金で補助科目がMFカード関連
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

      // 摘要からカード下4桁を抽出
      const cardMatch = remark.match(/[*＊](\d{4})\s/) || remark.match(/カード番号[:：]?\s*(\d{4})/);
      const cardLast4 = cardMatch ? cardMatch[1] : "unknown";

      // 従業員名を解決
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

    // 利用月の表示名
    const usageMonth = `${y}年${m}月`;

    console.log(
      `[withdrawal] unpaidTotal=${unpaidTotal}, breakdown=${unpaidBreakdown.length}cards, journals=${unpaidJournals.length}`,
    );

    return NextResponse.json({
      ok: true,
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
