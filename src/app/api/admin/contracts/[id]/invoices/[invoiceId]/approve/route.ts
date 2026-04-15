import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contractInvoices } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdminAuth } from "@/lib/api-auth";

/**
 * 請求書承認API
 *
 * POST: 請求書を承認（status='承認済', approvedBy, approvedAt を設定）
 */

type RouteContext = { params: Promise<{ id: string; invoiceId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const { id, invoiceId } = await context.params;
    const contractId = parseInt(id, 10);
    const invId = parseInt(invoiceId, 10);

    if (isNaN(contractId) || isNaN(invId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    // 対象の請求書を確認
    const [invoice] = await db
      .select()
      .from(contractInvoices)
      .where(eq(contractInvoices.id, invId));

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    if (invoice.contractId !== contractId) {
      return NextResponse.json(
        { error: "Invoice does not belong to this contract" },
        { status: 400 },
      );
    }

    if (invoice.status === "承認済") {
      return NextResponse.json(
        { error: "この請求書は既に承認済です" },
        { status: 409 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const approvedBy = body.approvedBy || "admin";

    await db
      .update(contractInvoices)
      .set({
        status: "承認済",
        approvedBy,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(contractInvoices.id, invId));

    console.log(
      `[contracts/invoices/approve] Approved: invoice=${invId} contract=${contractId} by=${approvedBy}`,
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[contracts/invoices/approve] POST Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
