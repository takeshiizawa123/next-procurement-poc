import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { purchaseRequests, journalRows } from "@/db/schema";
import { sql, desc } from "drizzle-orm";
import { requireBearerAuth } from "@/lib/api-auth";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

/**
 * 対話型AIアシスタントAPI
 * POST /api/ai/ask
 *
 * Body: { query: string, userId?: string }
 *
 * 購買・仕訳データをRAG検索し、Claude Haikuで回答を生成。
 * ユースケース:
 * - 「過去にモニター買った？」→ 購買履歴検索
 * - 「Amazon先月いくら？」→ 集計クエリ
 * - 「消耗品費の上位は？」→ 仕訳統計
 */
export async function POST(request: NextRequest) {
  const authError = requireBearerAuth(request);
  if (authError) return authError;

  try {
    const { query, userId } = await request.json();
    if (!query) {
      return NextResponse.json({ error: "query は必須です" }, { status: 400 });
    }

    // RAGコンテキストを構築（クエリに応じたDB検索）
    const context = await buildRagContext(query);

    // Claude Haikuで回答生成
    const answer = await generateAnswer(query, context);

    return NextResponse.json({ ok: true, answer, userId });
  } catch (error) {
    console.error("[ai/ask] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

async function buildRagContext(query: string): Promise<string> {
  const sections: string[] = [];

  // 1. 購買申請から関連レコードを検索
  try {
    const purchaseResults = await db
      .select({
        poNumber: purchaseRequests.poNumber,
        itemName: purchaseRequests.itemName,
        supplierName: purchaseRequests.supplierName,
        totalAmount: purchaseRequests.totalAmount,
        applicantName: purchaseRequests.applicantName,
        department: purchaseRequests.department,
        status: purchaseRequests.status,
        applicationDate: purchaseRequests.applicationDate,
        paymentMethod: purchaseRequests.paymentMethod,
      })
      .from(purchaseRequests)
      .where(
        sql`(
          ${purchaseRequests.itemName} ILIKE ${"%" + query + "%"}
          OR ${purchaseRequests.supplierName} ILIKE ${"%" + query + "%"}
          OR ${purchaseRequests.applicantName} ILIKE ${"%" + query + "%"}
          OR ${purchaseRequests.department} ILIKE ${"%" + query + "%"}
          OR ${purchaseRequests.poNumber} ILIKE ${"%" + query + "%"}
        )`,
      )
      .orderBy(desc(purchaseRequests.applicationDate))
      .limit(15);

    if (purchaseResults.length > 0) {
      sections.push("【購買申請の検索結果】");
      for (const r of purchaseResults) {
        sections.push(
          `  ${r.poNumber} | ${r.applicationDate ? new Date(r.applicationDate).toLocaleDateString("ja-JP") : ""} | ${r.itemName} | ¥${r.totalAmount?.toLocaleString()} | ${r.supplierName} | ${r.applicantName} (${r.department}) | ${r.status}`,
        );
      }
    }
  } catch { /* ignore */ }

  // 2. 仕訳データから関連レコードを検索
  try {
    const journalResults = await db
      .select({
        date: journalRows.date,
        remark: journalRows.remark,
        account: journalRows.account,
        taxType: journalRows.taxType,
        amount: journalRows.amount,
        counterparty: journalRows.counterparty,
        department: journalRows.department,
      })
      .from(journalRows)
      .where(
        sql`(
          ${journalRows.remark} ILIKE ${"%" + query + "%"}
          OR ${journalRows.counterparty} ILIKE ${"%" + query + "%"}
          OR ${journalRows.account} ILIKE ${"%" + query + "%"}
          OR ${journalRows.department} ILIKE ${"%" + query + "%"}
        )`,
      )
      .orderBy(desc(journalRows.date))
      .limit(15);

    if (journalResults.length > 0) {
      sections.push("【仕訳データの検索結果】");
      for (const r of journalResults) {
        sections.push(
          `  ${r.date} | ${r.remark} | ${r.account} (${r.taxType}) | ¥${r.amount?.toLocaleString()} | ${r.counterparty} | ${r.department}`,
        );
      }
    }
  } catch { /* ignore */ }

  // 3. 集計クエリ（「先月いくら」「上位」等のキーワード検出時）
  if (/いくら|合計|総額|月|上位|ランキング|件数/.test(query)) {
    try {
      // 取引先別・科目別の集計（直近3ヶ月）
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const fromDate = threeMonthsAgo.toISOString().slice(0, 10);

      const supplierStats = await db
        .select({
          supplierName: purchaseRequests.supplierName,
          count: sql<number>`COUNT(*)`.as("count"),
          total: sql<number>`SUM(${purchaseRequests.totalAmount})`.as("total"),
        })
        .from(purchaseRequests)
        .where(sql`${purchaseRequests.applicationDate} >= ${fromDate}`)
        .groupBy(purchaseRequests.supplierName)
        .orderBy(sql`total DESC`)
        .limit(10);

      if (supplierStats.length > 0) {
        sections.push("【直近3ヶ月の購入先別集計】");
        for (const s of supplierStats) {
          sections.push(`  ${s.supplierName}: ${s.count}件 ¥${Number(s.total).toLocaleString()}`);
        }
      }

      const accountStats = await db
        .select({
          account: journalRows.account,
          count: sql<number>`COUNT(*)`.as("count"),
          total: sql<number>`SUM(${journalRows.amount})`.as("total"),
        })
        .from(journalRows)
        .where(sql`${journalRows.date} >= ${fromDate}`)
        .groupBy(journalRows.account)
        .orderBy(sql`total DESC`)
        .limit(10);

      if (accountStats.length > 0) {
        sections.push("【直近3ヶ月の勘定科目別集計】");
        for (const s of accountStats) {
          sections.push(`  ${s.account}: ${s.count}件 ¥${Number(s.total).toLocaleString()}`);
        }
      }
    } catch { /* ignore */ }
  }

  if (sections.length === 0) {
    sections.push("（関連データが見つかりませんでした）");
  }

  return sections.join("\n");
}

async function generateAnswer(query: string, context: string): Promise<string> {
  if (!ANTHROPIC_API_KEY) {
    return "AIアシスタントが設定されていません（ANTHROPIC_API_KEY未設定）。";
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: `あなたは購買管理システムのAIアシスタントです。
以下のデータベース検索結果を基に、ユーザーの質問に簡潔に日本語で回答してください。

## ルール
- データにある情報のみで回答すること（推測しない）
- 金額は¥表記、日付は日本語表記
- 該当データがない場合は「該当するデータが見つかりませんでした」と回答
- 回答はSlackメッセージとして読みやすい形式（箇条書き等）で

## データベース検索結果
${context}

## ユーザーの質問
${query}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error: ${response.status} ${err}`);
  }

  const data = await response.json();
  const content = data.content?.[0];
  return content?.text || "回答を生成できませんでした。";
}
