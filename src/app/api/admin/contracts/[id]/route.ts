import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contracts, contractInvoices } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireAdminAuth } from "@/lib/api-auth";

/**
 * 個別契約API
 *
 * GET: 契約詳細 + 請求書一覧
 * PUT: 契約情報の部分更新
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

    const [contract] = await db
      .select()
      .from(contracts)
      .where(eq(contracts.id, contractId));

    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    const invoices = await db
      .select()
      .from(contractInvoices)
      .where(eq(contractInvoices.contractId, contractId))
      .orderBy(desc(contractInvoices.billingMonth));

    return NextResponse.json({ ok: true, contract, invoices });
  } catch (error) {
    console.error("[contracts/[id]] GET Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const contractId = parseInt(id, 10);
    if (isNaN(contractId)) {
      return NextResponse.json({ error: "Invalid contract ID" }, { status: 400 });
    }

    // 既存レコード確認
    const [existing] = await db
      .select()
      .from(contracts)
      .where(eq(contracts.id, contractId));

    if (!existing) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    const body = await request.json();

    // 更新可能フィールドのみ抽出（contractNumber, id, createdAt は不可）
    const updatable: Record<string, unknown> = {};
    const allowedFields = [
      "category",
      "billingType",
      "supplierName",
      "supplierContact",
      "monthlyAmount",
      "annualAmount",
      "budgetAmount",
      "contractStartDate",
      "contractEndDate",
      "renewalType",
      "renewalAlertDays",
      "accountTitle",
      "mfAccountCode",
      "mfTaxCode",
      "mfDepartmentCode",
      "mfCounterpartyCode",
      "department",
      "requesterSlackId",
      "approverSlackId",
      "autoApprove",
      "autoAccrue",
      "isActive",
      "notes",
      "contractFileUrl",
      "contractFileName",
    ];

    for (const field of allowedFields) {
      if (field in body) {
        updatable[field] = body[field];
      }
    }

    if (Object.keys(updatable).length === 0) {
      return NextResponse.json(
        { error: "更新するフィールドがありません" },
        { status: 400 },
      );
    }

    updatable.updatedAt = new Date();

    const [updated] = await db
      .update(contracts)
      .set(updatable)
      .where(eq(contracts.id, contractId))
      .returning();

    console.log(
      `[contracts/[id]] Updated: ${updated.contractNumber} fields=${Object.keys(updatable).join(",")}`,
    );

    return NextResponse.json({ ok: true, contract: updated });
  } catch (error) {
    console.error("[contracts/[id]] PUT Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
