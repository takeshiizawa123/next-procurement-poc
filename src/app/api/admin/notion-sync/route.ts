import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/api-auth";
import {
  getNotionClient,
  syncFlowDiagram,
  syncPrompt,
  recordChangelog,
  syncContract,
  FLOW_DEFINITIONS,
} from "@/lib/notion";
import { db } from "@/db";
import { contracts } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Notion同期API
 * POST /api/admin/notion-sync
 *
 * body.action:
 * - "sync-flows": 全業務フロー図をNotionに同期
 * - "sync-prompts": AIプロンプトをNotionに同期
 * - "sync-contracts": 契約マスタをNotionに同期
 * - "sync-all": 全て同期
 * - "record-changelog": コミット履歴を記録
 */
export async function POST(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const action = body.action as string;

    const notion = getNotionClient();
    if (!notion) {
      return NextResponse.json({
        ok: false,
        error: "NOTION_API_KEY が未設定です。Vercel環境変数に設定してください。",
      }, { status: 400 });
    }

    const results: Record<string, unknown> = {};

    // ========================================
    // フロー図同期
    // ========================================
    if (action === "sync-flows" || action === "sync-all") {
      const flowResults: Record<string, boolean> = {};
      for (const [key, flow] of Object.entries(FLOW_DEFINITIONS)) {
        flowResults[key] = await syncFlowDiagram(flow.title, flow.mermaid, flow.description);
      }
      results.flows = flowResults;
    }

    // ========================================
    // プロンプト同期
    // ========================================
    if (action === "sync-prompts" || action === "sync-all") {
      const prompts = [
        {
          name: "勘定科目推定プロンプト",
          module: "src/lib/account-estimator.ts",
          purpose: "品目名・仕入先・金額から勘定科目をRAGで推定。修正履歴をコンテキストに注入して精度向上。",
          prompt: "（account-estimator.ts のシステムプロンプト — 詳細はソースコード参照）",
          lastUpdated: new Date().toISOString().split("T")[0],
        },
        {
          name: "OCR証憑解析プロンプト",
          module: "src/lib/ocr.ts",
          purpose: "Gemini Visionで証憑画像から金額・日付・適格請求書番号を抽出。税率（10%/8%）を自動判定。",
          prompt: "（ocr.ts のGemini Visionプロンプト — 詳細はソースコード参照）",
          lastUpdated: new Date().toISOString().split("T")[0],
        },
        {
          name: "Slack AIアシスタントプロンプト",
          module: "src/app/api/ai/ask/route.ts",
          purpose: "Claude Haikuで購買・出張に関する質問にRAG応答。購買データ+仕訳統計をコンテキストに注入。",
          prompt: "（ask/route.ts のシステムプロンプト — 詳細はソースコード参照）",
          lastUpdated: new Date().toISOString().split("T")[0],
        },
      ];

      const promptResults: Record<string, boolean> = {};
      for (const p of prompts) {
        promptResults[p.name] = await syncPrompt(p);
      }
      results.prompts = promptResults;
    }

    // ========================================
    // 契約マスタ同期
    // ========================================
    if (action === "sync-contracts" || action === "sync-all") {
      const allContracts = await db.select().from(contracts);
      let synced = 0;
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
      }
      results.contracts = { total: allContracts.length, synced };
    }

    // ========================================
    // 変更履歴記録
    // ========================================
    if (action === "record-changelog") {
      const { commitHash, message, author, date, filesChanged } = body;
      if (!commitHash || !message) {
        return NextResponse.json({ ok: false, error: "commitHash and message are required" }, { status: 400 });
      }
      const ok = await recordChangelog({ commitHash, message, author: author || "unknown", date: date || new Date().toISOString().split("T")[0], filesChanged: filesChanged || 0 });
      results.changelog = ok;
    }

    return NextResponse.json({ ok: true, action, results });
  } catch (error) {
    console.error("[notion-sync] Error:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}

/**
 * 同期状態の確認
 * GET /api/admin/notion-sync
 */
export async function GET(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  const notion = getNotionClient();
  const configured = !!notion;
  const pageIds = {
    flowDiagram: !!process.env.NOTION_FLOW_PAGE_ID,
    promptDb: !!process.env.NOTION_PROMPT_DB_ID,
    changelogDb: !!process.env.NOTION_CHANGELOG_DB_ID,
    errorDb: !!process.env.NOTION_ERROR_DB_ID,
    contractDb: !!process.env.NOTION_CONTRACT_DB_ID,
  };

  return NextResponse.json({
    ok: true,
    configured,
    pageIds,
    ready: configured && Object.values(pageIds).some(Boolean),
  });
}
