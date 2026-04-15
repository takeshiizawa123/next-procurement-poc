import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contracts, contractInvoices } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAdminAuth } from "@/lib/api-auth";

/**
 * 契約別 月次請求書API
 *
 * GET:  請求書一覧（?month=YYYY-MM でフィルタ可能）
 * POST: 請求書の作成/更新（upsert — 同月の既存レコードがあれば更新）
 */

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const contractId = parseInt(id, 10);
    if (isNaN(contractId)) {
      return NextResponse.json({ error: "Invalid contract ID" }, { status: 400 });
    }

    const month = request.nextUrl.searchParams.get("month");

    let query = db
      .select()
      .from(contractInvoices)
      .where(eq(contractInvoices.contractId, contractId));

    if (month) {
      query = db
        .select()
        .from(contractInvoices)
        .where(
          and(
            eq(contractInvoices.contractId, contractId),
            eq(contractInvoices.billingMonth, month),
          ),
        );
    }

    const invoices = await query.orderBy(desc(contractInvoices.billingMonth));

    return NextResponse.json({ ok: true, invoices });
  } catch (error) {
    console.error("[contracts/[id]/invoices] GET Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const contractId = parseInt(id, 10);
    if (isNaN(contractId)) {
      return NextResponse.json({ error: "Invalid contract ID" }, { status: 400 });
    }

    // 契約の存在確認 + monthlyAmount取得
    const [contract] = await db
      .select()
      .from(contracts)
      .where(eq(contracts.id, contractId));

    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    const body = await request.json();
    const { billingMonth, invoiceAmount } = body;

    if (!billingMonth) {
      return NextResponse.json(
        { error: "billingMonth は必須です" },
        { status: 400 },
      );
    }

    const expectedAmount = contract.monthlyAmount ?? null;
    const amountDiff =
      invoiceAmount != null && expectedAmount != null
        ? invoiceAmount - expectedAmount
        : null;

    // 同月の既存レコードをチェック（upsert）
    const [existing] = await db
      .select()
      .from(contractInvoices)
      .where(
        and(
          eq(contractInvoices.contractId, contractId),
          eq(contractInvoices.billingMonth, billingMonth),
        ),
      );

    let invoice;

    if (existing) {
      // 既存レコードを更新
      [invoice] = await db
        .update(contractInvoices)
        .set({
          invoiceAmount: invoiceAmount ?? existing.invoiceAmount,
          expectedAmount,
          amountDiff,
          status: body.status ?? existing.status,
          voucherFileUrl: body.voucherFileUrl ?? existing.voucherFileUrl,
          voucherUploadedAt: body.voucherFileUrl ? new Date() : existing.voucherUploadedAt,
          updatedAt: new Date(),
        })
        .where(eq(contractInvoices.id, existing.id))
        .returning();

      console.log(
        `[contracts/[id]/invoices] Updated: contract=${contractId} month=${billingMonth}`,
      );
    } else {
      // 新規作成
      [invoice] = await db
        .insert(contractInvoices)
        .values({
          contractId,
          billingMonth,
          invoiceAmount: invoiceAmount ?? null,
          expectedAmount,
          amountDiff,
          status: body.status ?? "未受領",
          voucherFileUrl: body.voucherFileUrl || null,
          voucherUploadedAt: body.voucherFileUrl ? new Date() : null,
        })
        .returning();

      console.log(
        `[contracts/[id]/invoices] Created: contract=${contractId} month=${billingMonth}`,
      );
    }

    return NextResponse.json({ ok: true, invoice });
  } catch (error) {
    console.error("[contracts/[id]/invoices] POST Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
