import { NextRequest, NextResponse } from "next/server";
import { withCronGuard } from "@/lib/cron-helper";
import { db } from "@/db";
import { contracts } from "@/db/schema";
import {
  getNotionClient,
  syncFlowDiagram,
  syncPrompt,
  syncContract,
  FLOW_DEFINITIONS,
} from "@/lib/notion";

/**
 * Notion定期同期
 * GET /api/cron/notion-sync
 *
 * Vercel Cron: "0 9 * * *" (UTC 09:00 = JST 18:00, 毎日)
 *
 * 処理:
 * - 毎日: 契約マスタをNotionに同期（変更を反映）
 * - 毎月1日のみ: フロー図 + AIプロンプトも追加同期
 */
export const GET = withCronGuard("notion-sync", async (_request: NextRequest) => {
  const notion = getNotionClient();
  if (!notion) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "NOTION_API_KEY未設定 — Notion同期スキップ",
    });
  }

  const now = new Date();
  const isFirstOfMonth = now.getUTCDate() === 1;
  const results: Record<string, unknown> = {};

  // ========================================
  // 毎日: 契約マスタ同期
  // ========================================
  const allContracts = await db.select().from(contracts);
  let synced = 0;
  let failed = 0;
  for (const c of allContracts) {
    const ok = await syncContract({
      contractNumber: c.contractNumber,
      category: c.category,
      supplierName: c.supplierName,
      monthlyAmount: c.monthlyAmount || 0,
      accountTitle: c.accountTitle,
      department: c.department,
      startDate: c.contractStartDate,
      endDate: c.contractEndDate || undefined,
      isActive: c.isActive,
    });
    if (ok) synced++;
    else failed++;
  }
  results.contracts = { total: allContracts.length, synced, failed };

  // ========================================
  // 月次(1日のみ): フロー図 + プロンプト同期
  // ========================================
  if (isFirstOfMonth) {
    // フロー図
    const flowResults: Record<string, boolean> = {};
    for (const [key, flow] of Object.entries(FLOW_DEFINITIONS)) {
      flowResults[key] = await syncFlowDiagram(flow.title, flow.mermaid, flow.description);
    }
    results.flows = flowResults;

    // AIプロンプト
    const prompts = [
      {
        name: "勘定科目推定プロンプト",
        module: "src/lib/account-estimator.ts",
        purpose: "品目名・仕入先・金額から勘定科目をRAGで推定",
        prompt: "（ソースコード参照）",
        lastUpdated: now.toISOString().split("T")[0],
      },
      {
        name: "OCR証憑解析プロンプト",
        module: "src/lib/ocr.ts",
        purpose: "Gemini Visionで証憑画像から金額・日付・適格請求書番号を抽出",
        prompt: "（ソースコード参照）",
        lastUpdated: now.toISOString().split("T")[0],
      },
      {
        name: "Slack AIアシスタントプロンプト",
        module: "src/app/api/ai/ask/route.ts",
        purpose: "Claude Haikuで購買・出張に関する質問にRAG応答",
        prompt: "（ソースコード参照）",
        lastUpdated: now.toISOString().split("T")[0],
      },
    ];
    const promptResults: Record<string, boolean> = {};
    for (const p of prompts) {
      promptResults[p.name] = await syncPrompt(p);
    }
    results.prompts = promptResults;
  }

  console.log(
    `[notion-sync] contracts=${synced}/${allContracts.length}`,
    isFirstOfMonth ? ", monthly sync included" : "",
  );

  return NextResponse.json({
    ok: true,
    date: now.toISOString().split("T")[0],
    isFirstOfMonth,
    results,
  });
});
