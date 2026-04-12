import { NextRequest, NextResponse } from "next/server";
import { getSlackClient, notifyOps, safeDmChannel } from "@/lib/slack";
import { getRecentRequests } from "@/lib/gas-client";
import { reconcile, generateAlerts, type CardStatement } from "@/lib/reconciliation";
import { fetchAllCardStatements, type NormalizedCardStatement } from "@/lib/mf-expense";

const CRON_SECRET = process.env.CRON_SECRET || "";

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
    // 1. カード明細取得（MF経費API、過去30日分）
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const to = now.toISOString().slice(0, 10);
    let enrichedStatements: NormalizedCardStatement[] = [];
    try {
      enrichedStatements = await fetchAllCardStatements({ from, to, officeWide: true });
    } catch (e) {
      console.error("[card-reconciliation] fetchAllCardStatements failed:", e);
      try {
        const client = getSlackClient();
        await notifyOps(
          client,
          `🚨 *カード明細API障害* — MF Expense APIへの接続に失敗しました\nエラー: ${e instanceof Error ? e.message : String(e)}`,
        );
      } catch { /* Slack通知失敗は無視 */ }
    }

    // レガシー形式への変換（既存reconcile()用）
    const statements: CardStatement[] = enrichedStatements.map((s) => ({
      date: s.date,
      description: s.remark,
      amount: s.amount,
      cardName: s.memberName,
    }));

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

      // Amazon関連注記
      if (result.amazonRelated.count > 0) {
        lines.push(
          "",
          `📦 Amazon関連: ${result.amazonRelated.count}件（¥${result.amazonRelated.total.toLocaleString()}）`,
          `   → 仕訳管理ページの「Amazon照合」タブでCSV突合してください`,
        );
      }

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

      // 未申請カード利用を社員にDM通知
      if (result.noRequest.length > 0) {
        try {
          const { getEmployees } = await import("@/lib/gas-client");
          const empResult = await getEmployees();
          const employees = empResult.success ? (empResult.data?.employees || []) : [];

          // カード名 → 社員のSlackIDを解決してDM送信
          const grouped = new Map<string, CardStatement[]>();
          for (const st of result.noRequest) {
            const key = st.cardName || "不明";
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key)!.push(st);
          }

          for (const [cardName, items] of grouped) {
            const emp = employees.find((e) =>
              e.name === cardName || (e as unknown as Record<string, unknown>).card_holder_name === cardName);
            if (emp?.slackId) {
              const itemLines = items.slice(0, 5).map((s) =>
                `  • ${s.date} ${s.description} ¥${s.amount.toLocaleString()}`);
              if (items.length > 5) itemLines.push(`  …他 ${items.length - 5}件`);
              await client.chat.postMessage({
                channel: safeDmChannel(emp.slackId),
                text: [
                  `🔴 *未申請のカード利用が ${items.length}件 検出されました*`,
                  `事後報告が必要な場合は /purchase で「🚨 緊急事後報告」を選択してください。`,
                  "",
                  ...itemLines,
                ].join("\n"),
              });
            }
          }
        } catch (dmErr) {
          console.error("[card-reconciliation] DM notification error:", dmErr);
        }
      }
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

// fetchCardStatements は @/lib/mf-expense に移動済み（fetchAllCardStatements を使用）
