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
    // FormData（ファイルアップロード付き）とJSON両対応
    const contentType = request.headers.get("content-type") || "";
    let body: Record<string, unknown>;
    let file: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      body = {};
      for (const [key, value] of formData.entries()) {
        if (key === "file") {
          file = value as File;
        } else if (key === "autoApprove" || key === "autoAccrue" || key === "isActive") {
          body[key] = value === "true";
        } else if (
          key === "monthlyAmount" ||
          key === "annualAmount" ||
          key === "budgetAmount" ||
          key === "renewalAlertDays"
        ) {
          body[key] = value ? Number(value) : null;
        } else {
          body[key] = value;
        }
      }
    } else {
      body = await request.json();
    }

    const category = body.category as string;
    const billingType = body.billingType as string;
    const supplierName = body.supplierName as string;
    const accountTitle = body.accountTitle as string;
    const department = body.department as string;
    const contractStartDate = body.contractStartDate as string;

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

    // 重複検知: 同じ取引先+開始日の既存契約
    const duplicateCheck = body.skipDuplicateCheck === true || body.skipDuplicateCheck === "true";
    if (!duplicateCheck) {
      const existing = await db
        .select()
        .from(contracts)
        .where(
          and(
            eq(contracts.supplierName, supplierName),
            eq(contracts.contractStartDate, contractStartDate),
            eq(contracts.isActive, true),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        return NextResponse.json(
          {
            error: "duplicate",
            message: `同じ取引先+開始日の有効契約が既に存在します: ${existing[0].contractNumber}`,
            existing: existing[0],
          },
          { status: 409 },
        );
      }
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
        category: body.category as "派遣" | "外注" | "SaaS" | "顧問" | "賃貸" | "保守" | "清掃" | "その他",
        billingType: body.billingType as "固定" | "従量" | "カード自動",
        supplierName: supplierName,
        supplierContact: (body.supplierContact as string) || null,
        monthlyAmount: (body.monthlyAmount as number) ?? null,
        annualAmount: (body.annualAmount as number) ?? null,
        budgetAmount: (body.budgetAmount as number) ?? null,
        contractStartDate,
        contractEndDate: (body.contractEndDate as string) || null,
        renewalType: (body.renewalType as string) || "自動更新",
        renewalAlertDays: (body.renewalAlertDays as number) ?? 60,
        accountTitle,
        mfAccountCode: (body.mfAccountCode as string) || null,
        mfTaxCode: (body.mfTaxCode as string) || null,
        mfDepartmentCode: (body.mfDepartmentCode as string) || null,
        mfCounterpartyCode: (body.mfCounterpartyCode as string) || null,
        department,
        requesterSlackId: (body.requesterSlackId as string) || null,
        approverSlackId: (body.approverSlackId as string) || null,
        autoApprove: (body.autoApprove as boolean) ?? false,
        autoAccrue: (body.autoAccrue as boolean) ?? true,
        isActive: (body.isActive as boolean) ?? true,
        notes: (body.notes as string) || null,
        contractFileName: file ? file.name : null,
      })
      .returning();

    console.log(
      `[contracts] Created: ${contractNumber} ${supplierName} (${category})`,
    );

    // Notion同期+ファイルアップロード（同期実行、失敗しても契約作成は保持）
    let notionUrl: string | null = null;
    try {
      const { uploadFileToNotion, syncContract } = await import("@/lib/notion");

      // ファイルアップロード（ある場合のみ）
      let fileUploadId: string | undefined;
      if (file && file.size > 0) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const uploaded = await uploadFileToNotion(buffer, file.name, file.type);
        if (uploaded) fileUploadId = uploaded;
      }

      notionUrl = await syncContract({
        contractNumber,
        category,
        supplierName,
        monthlyAmount: (body.monthlyAmount as number) || 0,
        accountTitle,
        department,
        startDate: contractStartDate,
        endDate: (body.contractEndDate as string) || undefined,
        isActive: true,
        fileUploadId,
        fileName: file?.name,
      });

      // DB更新: 契約書URL（Notionページへのリンク）を保存
      if (notionUrl) {
        await db
          .update(contracts)
          .set({ contractFileUrl: notionUrl })
          .where(eq(contracts.id, result.id));
      }
    } catch (notionErr) {
      console.error("[contracts] Notion sync failed:", notionErr);
    }

    return NextResponse.json({
      ok: true,
      contract: { ...result, contractFileUrl: notionUrl },
    });
  } catch (error) {
    console.error("[contracts] POST Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
