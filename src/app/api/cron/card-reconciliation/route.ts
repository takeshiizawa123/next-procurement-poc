import { NextRequest, NextResponse } from "next/server";
import { getSlackClient, notifyOps } from "@/lib/slack";
import { getRecentRequests } from "@/lib/gas-client";
import { reconcile, generateAlerts, type CardStatement } from "@/lib/reconciliation";

const CRON_SECRET = process.env.CRON_SECRET || "";
const MF_EXPENSE_TOKEN = process.env.MF_EXPENSE_ACCESS_TOKEN || "";
const MF_EXPENSE_OFFICE_ID = process.env.MF_EXPENSE_OFFICE_ID || "";

/**
 * カード明細突合バッチ（週次）
 * GET /api/cron/card-reconciliation
 *
 * Vercel Cron: "0 2 * * 1" (UTC 02:00 Mon = JST 11:00 月曜)
 *
 * 1. MF経費APIからカード明細取得
 * 2. GASから購買台帳取得
 * 3. 突合実行
 * 4. アラートを管理本部チャンネルに投稿
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. カード明細取得（MF経費API）
    const statements = await fetchCardStatements();

    if (statements.length === 0) {
      return NextResponse.json({ ok: true, message: "カード明細なし", alerts: 0 });
    }

    // 2. 購買台帳取得
    const gasResult = await getRecentRequests(undefined, 100);
    const requests = gasResult.success ? (gasResult.data?.requests || []) : [];

    // 3. 突合実行
    const result = reconcile(statements, requests);
    const alerts = generateAlerts(result);

    // 4. Slack通知
    if (alerts.length > 0) {
      const client = getSlackClient();
      const lines = [
        `🔍 *カード明細突合レポート* — ${new Date().toLocaleDateString("ja-JP")}`,
        `対象: ${statements.length}件の明細 / ${requests.length}件の申請`,
        "",
        `✅ マッチ: ${result.matched.length}件`,
        `🔴 未申請: ${result.noRequest.length}件`,
        `🟡 承認前購入: ${result.preApproval.length}件`,
        `🟠 金額不一致: ${result.amountMismatch.length}件`,
      ];

      // HIGH severity アラートのみ詳細表示
      const highAlerts = alerts.filter((a) => a.severity === "HIGH");
      if (highAlerts.length > 0) {
        lines.push("", "🚨 *要対応:*");
        for (const a of highAlerts.slice(0, 10)) {
          lines.push(`  • ${a.message}`);
        }
        if (highAlerts.length > 10) {
          lines.push(`  …他 ${highAlerts.length - 10}件`);
        }
      }

      const medAlerts = alerts.filter((a) => a.severity === "MEDIUM");
      if (medAlerts.length > 0) {
        lines.push("", `⚠️ *確認推奨: ${medAlerts.length}件*`);
        for (const a of medAlerts.slice(0, 5)) {
          lines.push(`  • ${a.message}`);
        }
      }

      await notifyOps(client, lines.join("\n"));
    }

    return NextResponse.json({
      ok: true,
      statements: statements.length,
      matched: result.matched.length,
      alerts: alerts.length,
      noRequest: result.noRequest.length,
      preApproval: result.preApproval.length,
      amountMismatch: result.amountMismatch.length,
    });
  } catch (error) {
    console.error("[card-reconciliation] Error:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}

/**
 * MF経費APIからカード明細を取得
 * 直近30日分のカード経費明細を取得
 */
async function fetchCardStatements(): Promise<CardStatement[]> {
  if (!MF_EXPENSE_TOKEN || !MF_EXPENSE_OFFICE_ID) {
    console.warn("[card-reconciliation] MF Expense credentials not set, using empty statements");
    return [];
  }

  try {
    const url = `https://expense.moneyforward.com/api/external/v1/offices/${MF_EXPENSE_OFFICE_ID}/me/ex_transactions`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${MF_EXPENSE_TOKEN}` },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.error("[card-reconciliation] MF API error:", res.status, await res.text());
      return [];
    }

    const data = (await res.json()) as Array<{
      recognized_at?: string;
      remark?: string;
      value?: number;
    }>;

    return data
      .filter((tx) => tx.recognized_at && tx.value)
      .map((tx) => ({
        date: tx.recognized_at || "",
        description: tx.remark || "",
        amount: tx.value || 0,
      }));
  } catch (e) {
    console.error("[card-reconciliation] Fetch error:", e);
    return [];
  }
}
