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

    // FormData（ファイルアップロード）またはJSON（API呼出し）の両方に対応
    const contentType = request.headers.get("content-type") || "";
    let billingMonth: string | undefined;
    let invoiceAmount: number | null = null;
    let status: "未受領" | "受領済" | "承認済" | "仕訳済" | "見積計上" | undefined;
    let voucherFileUrl: string | undefined;
    let hours: string | undefined;
    let units: string | undefined;
    let reportNotes: string | undefined;
    let journalId: number | undefined;
    let file: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      billingMonth = formData.get("billingMonth") as string || undefined;
      const amountStr = formData.get("invoiceAmount") as string;
      invoiceAmount = amountStr ? parseInt(amountStr, 10) : null;
      const rawStatus = formData.get("status") as string;
      if (rawStatus && ["未受領", "受領済", "承認済", "仕訳済", "見積計上"].includes(rawStatus)) {
        status = rawStatus as typeof status;
      }
      hours = formData.get("hours") as string || undefined;
      units = formData.get("units") as string || undefined;
      reportNotes = formData.get("reportNotes") as string || undefined;
      file = formData.get("file") as File | null;
    } else {
      const body = await request.json();
      billingMonth = body.billingMonth;
      invoiceAmount = body.invoiceAmount ?? null;
      if (body.status && ["未受領", "受領済", "承認済", "仕訳済", "見積計上"].includes(body.status)) {
        status = body.status as typeof status;
      }
      voucherFileUrl = body.voucherFileUrl;
      hours = body.hours;
      units = body.units;
      reportNotes = body.reportNotes;
      journalId = body.journalId;
    }

    if (!billingMonth) {
      return NextResponse.json(
        { error: "billingMonth は必須です" },
        { status: 400 },
      );
    }

    // ファイルアップロード → Slack OPSチャンネルに投稿してpermalinkを取得
    if (file && file.size > 0) {
      try {
        const { getSlackClient, safeDmChannel } = await import("@/lib/slack");
        const client = getSlackClient();
        const opsChannel = process.env.SLACK_OPS_CHANNEL;
        if (opsChannel) {
          const buffer = Buffer.from(await file.arrayBuffer());
          const uploadResult = await client.filesUploadV2({
            channel_id: safeDmChannel(opsChannel),
            file: buffer,
            filename: file.name,
            title: `${contract.contractNumber} ${billingMonth} 証憑`,
            initial_comment: `📎 契約 ${contract.contractNumber}（${contract.supplierName}）${billingMonth} の証憑`,
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fileObj = (uploadResult as any)?.files?.[0];
          voucherFileUrl = fileObj?.permalink || fileObj?.url_private || undefined;
        }
      } catch (uploadErr) {
        console.error("[contracts/invoices] File upload failed:", uploadErr);
        // アップロード失敗でもinvoice作成は続行
      }
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
          status: status ?? existing.status,
          voucherFileUrl: voucherFileUrl ?? existing.voucherFileUrl,
          voucherUploadedAt: voucherFileUrl ? new Date() : existing.voucherUploadedAt,
          hours: hours ?? existing.hours,
          units: units ?? existing.units,
          reportNotes: reportNotes ?? existing.reportNotes,
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
          status: status ?? "未受領",
          voucherFileUrl: voucherFileUrl || null,
          voucherUploadedAt: voucherFileUrl ? new Date() : null,
          hours: hours || null,
          units: units || null,
          reportNotes: reportNotes || null,
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
