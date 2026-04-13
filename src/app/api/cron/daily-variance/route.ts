import { NextRequest, NextResponse } from "next/server";
import { getSlackClient } from "@/lib/slack";
import { getPredictedTransactions } from "@/lib/gas-client";
import type { PredictedTransaction } from "@/lib/gas-client";

const CRON_SECRET = process.env.CRON_SECRET || "";
const OPS_CHANNEL = process.env.SLACK_OPS_CHANNEL || "";

/** 乖離閾値 */
const DIFF_RATE_THRESHOLD = 0.1; // ±10%
const DIFF_ABS_THRESHOLD = 1000; // ±1,000円
const STALE_PENDING_DAYS = 3; // pending のまま3日以上

/**
 * 日次金額乖離アラート
 * GET /api/cron/daily-variance
 *
 * Vercel Cron: "0 3 * * *" (UTC 03:00 = JST 12:00)
 *
 * - matched 明細の金額乖離を検知
 * - pending のまま3日以上経過した明細を検知
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!OPS_CHANNEL) {
    return NextResponse.json({ ok: false, error: "SLACK_OPS_CHANNEL not set" });
  }

  try {
    const client = getSlackClient();
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const result = await getPredictedTransactions(month);
    const predictions = result.success ? (result.data?.predictions || []) : [];

    if (predictions.length === 0) {
      return NextResponse.json({ ok: true, alerts: 0, message: "No predictions for current month" });
    }

    // 1. matched 明細の金額乖離チェック
    const varianceAlerts: Array<PredictedTransaction & { diffPct: number }> = [];
    for (const p of predictions) {
      if (p.status !== "matched" || p.amount_diff == null) continue;
      const absDiff = Math.abs(p.amount_diff);
      const diffPct = p.predicted_amount > 0 ? absDiff / p.predicted_amount : 0;
      if (absDiff > DIFF_ABS_THRESHOLD || diffPct > DIFF_RATE_THRESHOLD) {
        varianceAlerts.push({ ...p, diffPct });
      }
    }

    // 2. pending のまま3日以上経過
    const stalePending: Array<PredictedTransaction & { staleDays: number }> = [];
    for (const p of predictions) {
      if (p.status !== "pending") continue;
      const created = new Date(p.created_at);
      const days = Math.floor((now.getTime() - created.getTime()) / 86400000);
      if (days >= STALE_PENDING_DAYS) {
        stalePending.push({ ...p, staleDays: days });
      }
    }

    const totalAlerts = varianceAlerts.length + stalePending.length;

    if (totalAlerts === 0) {
      return NextResponse.json({ ok: true, alerts: 0, message: "No variance alerts" });
    }

    // Slack メッセージ組み立て
    const lines: string[] = [
      `⚠️ *日次金額乖離アラート* — ${now.toLocaleDateString("ja-JP")}（${month}）`,
    ];

    if (varianceAlerts.length > 0) {
      varianceAlerts.sort((a, b) => Math.abs(b.amount_diff!) - Math.abs(a.amount_diff!));
      lines.push("", `🔴 *金額乖離（${varianceAlerts.length}件）* — 閾値: ±10% or ±¥1,000`);
      for (const v of varianceAlerts.slice(0, 10)) {
        const sign = v.amount_diff! > 0 ? "+" : "";
        const pct = (v.diffPct * 100).toFixed(1);
        lines.push(
          `  • ${v.po_number}: ${v.supplier} — 予測 ¥${v.predicted_amount.toLocaleString()} → 差額 ${sign}¥${v.amount_diff!.toLocaleString()}（${sign}${pct}%） [${v.applicant}]`,
        );
      }
      if (varianceAlerts.length > 10) {
        lines.push(`  …他 ${varianceAlerts.length - 10}件`);
      }
    }

    if (stalePending.length > 0) {
      stalePending.sort((a, b) => b.staleDays - a.staleDays);
      lines.push("", `🟡 *未マッチ停滞（${stalePending.length}件）* — pending ${STALE_PENDING_DAYS}日以上`);
      for (const s of stalePending.slice(0, 10)) {
        lines.push(
          `  • ${s.po_number}: ${s.supplier} — ¥${s.predicted_amount.toLocaleString()}（${s.staleDays}日経過） [${s.applicant}]`,
        );
      }
      if (stalePending.length > 10) {
        lines.push(`  …他 ${stalePending.length - 10}件`);
      }
    }

    await client.chat.postMessage({
      channel: OPS_CHANNEL,
      text: lines.join("\n"),
    });

    return NextResponse.json({
      ok: true,
      alerts: totalAlerts,
      variance: varianceAlerts.length,
      stalePending: stalePending.length,
    });
  } catch (error) {
    console.error("[daily-variance] Error:", error);
    // OPS通知（Cron失敗アラート）
    try {
      const client = getSlackClient();
      const opsChannel = process.env.SLACK_OPS_CHANNEL;
      if (opsChannel) {
        await client.chat.postMessage({ channel: opsChannel, text: `🚨 *Cron失敗: daily-variance*\nエラー: ${String(error).slice(0, 300)}` });
      }
    } catch { /* 通知失敗は無視 */ }
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
