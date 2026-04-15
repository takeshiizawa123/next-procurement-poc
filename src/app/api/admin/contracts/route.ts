import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contracts } from "@/db/schema";
import { desc, eq, sql, and, like } from "drizzle-orm";
import { requireAdminAuth } from "@/lib/api-auth";

/**
 * 継続契約マスタAPI
 *
 * GET:  契約一覧（?active=true で有効のみ）
 * POST: 新規契約作成（CT-YYYYMM-NNNN を自動採番）
 */

export async function GET(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const activeOnly = request.nextUrl.searchParams.get("active") === "true";

    let query = db.select().from(contracts);

    if (activeOnly) {
      query = query.where(eq(contracts.isActive, true)) as typeof query;
    }

    const results = await query.orderBy(
      desc(contracts.isActive),
      desc(contracts.createdAt),
    );

    return NextResponse.json({ ok: true, contracts: results });
  } catch (error) {
    console.error("[contracts] GET Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();

    const {
      category,
      billingType,
      supplierName,
      accountTitle,
      department,
      contractStartDate,
    } = body;

    if (
      !category ||
      !billingType ||
      !supplierName ||
      !accountTitle ||
      !department ||
      !contractStartDate
    ) {
      return NextResponse.json(
        {
          error:
            "category, billingType, supplierName, accountTitle, department, contractStartDate は必須です",
        },
        { status: 400 },
      );
    }

    // 契約番号の自動採番: CT-YYYYMM-NNNN
    const now = new Date();
    const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const prefix = `CT-${yyyymm}-`;

    const [maxResult] = await db
      .select({ maxNum: sql<string>`MAX(${contracts.contractNumber})` })
      .from(contracts)
      .where(like(contracts.contractNumber, `${prefix}%`));

    let nextSeq = 1;
    if (maxResult?.maxNum) {
      const lastSeq = parseInt(maxResult.maxNum.split("-").pop() || "0", 10);
      nextSeq = lastSeq + 1;
    }

    const contractNumber = `${prefix}${String(nextSeq).padStart(4, "0")}`;

    const [result] = await db
      .insert(contracts)
      .values({
        contractNumber,
        category: body.category,
        billingType: body.billingType,
        supplierName: body.supplierName,
        supplierContact: body.supplierContact || null,
        monthlyAmount: body.monthlyAmount ?? null,
        annualAmount: body.annualAmount ?? null,
        budgetAmount: body.budgetAmount ?? null,
        contractStartDate: body.contractStartDate,
        contractEndDate: body.contractEndDate || null,
        renewalType: body.renewalType || "自動更新",
        renewalAlertDays: body.renewalAlertDays ?? 60,
        accountTitle: body.accountTitle,
        mfAccountCode: body.mfAccountCode || null,
        mfTaxCode: body.mfTaxCode || null,
        mfDepartmentCode: body.mfDepartmentCode || null,
        mfCounterpartyCode: body.mfCounterpartyCode || null,
        department: body.department,
        requesterSlackId: body.requesterSlackId || null,
        approverSlackId: body.approverSlackId || null,
        autoApprove: body.autoApprove ?? false,
        autoAccrue: body.autoAccrue ?? true,
        isActive: body.isActive ?? true,
        notes: body.notes || null,
      })
      .returning();

    console.log(
      `[contracts] Created: ${contractNumber} ${supplierName} (${category})`,
    );

    // Notionに非同期で同期（失敗しても契約作成は成功）
    import("@/lib/notion").then(({ syncContract }) =>
      syncContract({
        contractNumber,
        category,
        supplierName,
        monthlyAmount: body.monthlyAmount || 0,
        accountTitle: body.accountTitle,
        department: body.department,
        startDate: body.contractStartDate,
        endDate: body.contractEndDate || undefined,
        isActive: true,
      }),
    ).catch(() => {});

    return NextResponse.json({ ok: true, contract: result });
  } catch (error) {
    console.error("[contracts] POST Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
