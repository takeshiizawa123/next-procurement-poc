import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { purchaseRequests } from "@/db/schema";
import { sql, desc } from "drizzle-orm";
import { requireApiKey } from "@/lib/api-auth";

/**
 * 購買申請 全文検索API
 * GET /api/purchase/search?q=モニター&limit=20
 *
 * pg_trgm GINインデックスを利用した曖昧検索。
 * 品目名・購入先名・申請者名を横断検索する。
 */
export async function GET(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const q = request.nextUrl.searchParams.get("q")?.trim();
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = Math.min(parseInt(limitParam || "20", 10) || 20, 100);

  if (!q || q.length < 1) {
    return NextResponse.json({ error: "検索キーワード(q)を指定してください" }, { status: 400 });
  }

  try {
    // pg_trgm の similarity + ILIKE で曖昧検索
    // similarity スコアで関連度順にソート
    const pattern = `%${q}%`;

    const results = await db
      .select({
        poNumber: purchaseRequests.poNumber,
        itemName: purchaseRequests.itemName,
        supplierName: purchaseRequests.supplierName,
        applicantName: purchaseRequests.applicantName,
        department: purchaseRequests.department,
        totalAmount: purchaseRequests.totalAmount,
        status: purchaseRequests.status,
        applicationDate: purchaseRequests.applicationDate,
        paymentMethod: purchaseRequests.paymentMethod,
        // similarity スコア（品目名 or 購入先名の高い方）
        score: sql<number>`GREATEST(
          COALESCE(similarity(${purchaseRequests.itemName}, ${q}), 0),
          COALESCE(similarity(${purchaseRequests.supplierName}, ${q}), 0),
          COALESCE(similarity(${purchaseRequests.applicantName}, ${q}), 0)
        )`.as("score"),
      })
      .from(purchaseRequests)
      .where(
        sql`(
          ${purchaseRequests.itemName} ILIKE ${pattern}
          OR ${purchaseRequests.supplierName} ILIKE ${pattern}
          OR ${purchaseRequests.applicantName} ILIKE ${pattern}
          OR ${purchaseRequests.poNumber} ILIKE ${pattern}
        )`,
      )
      .orderBy(sql`score DESC`, desc(purchaseRequests.applicationDate))
      .limit(limit);

    return NextResponse.json({
      ok: true,
      query: q,
      count: results.length,
      results,
    });
  } catch (error) {
    console.error("[purchase-search] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
