import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountCorrections } from "@/db/schema";
import { desc, sql } from "drizzle-orm";
import { requireBearerAuth } from "@/lib/api-auth";

/**
 * 勘定科目修正記録API
 *
 * POST: 修正を記録（仕訳管理画面で科目変更時に呼ぶ）
 * GET:  修正履歴を取得（RAGコンテキスト用、取引先/品目でフィルタ可能）
 */

export async function POST(request: NextRequest) {
  const authError = requireBearerAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const {
      poNumber, itemName, supplierName, department, totalAmount,
      estimatedAccount, estimatedTaxType, estimatedConfidence,
      correctedAccount, correctedTaxType, correctedBy,
    } = body;

    if (!poNumber || !itemName || !estimatedAccount || !correctedAccount) {
      return NextResponse.json(
        { error: "poNumber, itemName, estimatedAccount, correctedAccount は必須です" },
        { status: 400 },
      );
    }

    // 同じ科目なら記録しない（修正なし）
    if (estimatedAccount === correctedAccount && estimatedTaxType === correctedTaxType) {
      return NextResponse.json({ ok: true, skipped: true, reason: "修正なし" });
    }

    const [result] = await db.insert(accountCorrections).values({
      poNumber,
      itemName,
      supplierName: supplierName || null,
      department: department || null,
      totalAmount: totalAmount || null,
      estimatedAccount,
      estimatedTaxType: estimatedTaxType || null,
      estimatedConfidence: estimatedConfidence || null,
      correctedAccount,
      correctedTaxType: correctedTaxType || null,
      correctedBy: correctedBy || null,
    }).returning({ id: accountCorrections.id });

    console.log(
      `[account-correction] Recorded: ${poNumber} ${estimatedAccount} → ${correctedAccount} (by ${correctedBy})`,
    );

    return NextResponse.json({ ok: true, id: result.id });
  } catch (error) {
    console.error("[account-correction] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  const authError = requireBearerAuth(request);
  if (authError) return authError;

  try {
    const supplier = request.nextUrl.searchParams.get("supplier") || "";
    const keyword = request.nextUrl.searchParams.get("keyword") || "";
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = Math.min(parseInt(limitParam || "50", 10) || 50, 200);

    let query = db.select().from(accountCorrections);

    if (supplier && keyword) {
      query = query.where(
        sql`(${accountCorrections.supplierName} ILIKE ${"%" + supplier + "%"}
         OR ${accountCorrections.itemName} ILIKE ${"%" + keyword + "%"})`,
      ) as typeof query;
    } else if (supplier) {
      query = query.where(
        sql`${accountCorrections.supplierName} ILIKE ${"%" + supplier + "%"}`,
      ) as typeof query;
    } else if (keyword) {
      query = query.where(
        sql`${accountCorrections.itemName} ILIKE ${"%" + keyword + "%"}`,
      ) as typeof query;
    }

    const results = await query
      .orderBy(desc(accountCorrections.createdAt))
      .limit(limit);

    return NextResponse.json({ ok: true, count: results.length, corrections: results });
  } catch (error) {
    console.error("[account-correction] GET Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
