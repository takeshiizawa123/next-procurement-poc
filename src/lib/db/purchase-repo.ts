/**
 * 購買申請リポジトリ（registerPurchase, getStatus, updateStatus）
 */

import { and, desc, eq, like } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  purchaseRequests,
  type NewPurchaseRequest,
} from "@/db/schema";
import {
  type DbResponse,
  type RegisterResult,
  type UpdateResult,
  type PurchaseStatus,
  ok,
  ng,
  deriveApprovalStatus,
  deriveOrderStatus,
  deriveVoucherStatus,
  deriveInspectionStatus,
  invalidateRecentRequests,
} from "./types";
import { writeAuditLog } from "./audit-repo";

/**
 * PO番号生成（PO-YYYYMM-NNNN）
 * 月ごとの連番をDBから取得して採番
 */
async function generatePoNumber(): Promise<string> {
  const now = new Date();
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `PO-${yyyymm}-`;

  // 該当月の最大連番を取得
  const result = await db
    .select({ poNumber: purchaseRequests.poNumber })
    .from(purchaseRequests)
    .where(like(purchaseRequests.poNumber, `${prefix}%`))
    .orderBy(desc(purchaseRequests.poNumber))
    .limit(1);

  let seq = 1;
  if (result.length > 0) {
    const last = result[0].poNumber;
    const m = last.match(/-(\d{4})$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

/**
 * 購買申請を新規登録
 */
export async function registerPurchase(data: {
  applicant: string;
  itemName: string;
  totalAmount: number;
  unitPrice?: number;
  quantity?: number;
  purchaseSource?: string;
  purchaseSourceUrl?: string;
  hubspotInfo?: string;
  budgetNumber?: string;
  katanaPo?: string;
  paymentMethod?: string;
  approver?: string;
  inspector?: string;
  purpose?: string;
  poNumber?: string;
  accountTitle?: string;
  remarks?: string;
  slackTs?: string;
  isPurchased?: boolean;
  hasEvidence?: boolean;
  isEstimate?: boolean;
  isPostReport?: boolean;
}): Promise<DbResponse<RegisterResult>> {
  try {
    const poNumber = data.poNumber || (await generatePoNumber());

    // 申請者情報から従業員マスタで部門を引く
    const applicantEmp = await db
      .select()
      .from(employees)
      .where(eq(employees.name, data.applicant))
      .limit(1);
    const department = applicantEmp[0]?.departmentName ?? "";
    const applicantSlackId = applicantEmp[0]?.slackId ?? "";

    const newRow: NewPurchaseRequest = {
      poNumber,
      status: data.isPurchased ? "検収済" : "申請済",
      requestType: data.isPurchased ? "購入済" : "購入前",
      applicantSlackId,
      applicantName: data.applicant,
      department,
      approverName: data.approver ?? null,
      inspectorName: data.inspector ?? null,
      itemName: data.itemName,
      unitPrice: data.unitPrice ?? data.totalAmount,
      quantity: data.quantity ?? 1,
      totalAmount: data.totalAmount,
      paymentMethod: (data.paymentMethod as "会社カード" | "請求書払い" | "立替") ?? "会社カード",
      purpose: data.purpose ?? null,
      supplierName: data.purchaseSource ?? null,
      supplierUrl: data.purchaseSourceUrl ?? null,
      hubspotDealId: data.hubspotInfo ?? null,
      budgetNumber: data.budgetNumber ?? null,
      katanaPoNumber: data.katanaPo ?? null,
      accountTitle: data.accountTitle ?? null,
      remarks: data.remarks ?? null,
      slackMessageTs: data.slackTs ?? null,
      voucherStatus: data.hasEvidence ? "uploaded" : "none",
      isEstimate: data.isEstimate ?? false,
      isPostReport: data.isPostReport ?? false,
    };

    const inserted = await db.insert(purchaseRequests).values(newRow).returning({ poNumber: purchaseRequests.poNumber });

    // 関連キャッシュ無効化
    await invalidateRecentRequests();

    return ok({ prNumber: inserted[0].poNumber, rowNumber: 0 });
  } catch (e) {
    return ng(e instanceof Error ? e.message : String(e));
  }
}

/**
 * PO番号でステータスを照会
 */
export async function getStatus(prNumber: string): Promise<DbResponse<PurchaseStatus>> {
  try {
    const rows = await db
      .select()
      .from(purchaseRequests)
      .where(eq(purchaseRequests.poNumber, prNumber))
      .limit(1);

    if (rows.length === 0) {
      return ng(`PO番号 ${prNumber} が見つかりません`, 404);
    }

    const row = rows[0];
    // 金額照合: OCR証憑金額 vs 申請合計額（許容±500円 or ±5%）
    let amountMatch = "";
    if (row.voucherAmount != null && row.totalAmount > 0) {
      const diff = Math.abs(row.voucherAmount - row.totalAmount);
      const ratio = diff / row.totalAmount;
      if (diff <= 500 || ratio <= 0.05) amountMatch = "一致";
      else amountMatch = `差額 ¥${(row.voucherAmount - row.totalAmount).toLocaleString()}`;
    }
    // 既存UI互換のため日本語フィールド名で返す（フロントエンドのキー名と完全一致させる）
    const status: PurchaseStatus = {
      購買番号: row.poNumber,
      発注承認ステータス: deriveApprovalStatus(row.status),
      発注ステータス: deriveOrderStatus(row.status),
      検収ステータス: deriveInspectionStatus(row.status),
      品目名: row.itemName,
      申請者: row.applicantName,
      部門: row.department,
      "合計額（税込）": String(row.totalAmount ?? ""),
      "単価（税込・円）": String(row.unitPrice ?? ""),
      数量: String(row.quantity ?? 1),
      購入先名: row.supplierName ?? "",
      購入先URL: row.supplierUrl ?? "",
      支払方法: row.paymentMethod,
      購入品の用途: row.purpose ?? "",
      購入理由: row.remarks ?? "", // 購入理由は備考から流用
      承認者: row.approverName ?? "",
      検収者: row.inspectorName ?? "",
      証憑対応: deriveVoucherStatus(row.voucherStatus, row.status),
      証憑金額: row.voucherAmount != null ? String(row.voucherAmount) : "",
      金額照合: amountMatch,
      適格番号: row.registrationNumber ?? "",
      税区分: row.mfTaxCode ?? "",
      勘定科目: row.accountTitle ?? "",
      備考: row.remarks ?? "",
      申請日: row.applicationDate?.toISOString() ?? "",
      検収日: row.inspectedAt?.toISOString() ?? "",
      検収コメント: "",
      "スレッドTS": row.slackThreadTs ?? row.slackMessageTs ?? "",
      "KATANA PO番号": row.katanaPoNumber ?? "",
      // UI 互換: DB の "購入済" → レガシー UI では "購入報告" として特殊表示
      申請区分: row.requestType === "購入済" ? "購入報告" : row.requestType,
      _rowNumber: 0,
      _raw: row,
    };

    return ok(status);
  } catch (e) {
    return ng(e instanceof Error ? e.message : String(e));
  }
}

/**
 * PO番号でステータスを更新
 */
export async function updateStatus(
  prNumber: string,
  updates: Record<string, string>,
): Promise<DbResponse<UpdateResult>> {
  try {
    // 日本語フィールド名をスキーマフィールドにマッピング
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped: Partial<any> = { updatedAt: new Date() };
    const updatedFields: string[] = [];

    for (const [key, value] of Object.entries(updates)) {
      switch (key) {
        case "発注承認ステータス":
          if (value === "承認済") {
            mapped.status = "承認済";
            mapped.approvedAt = new Date();
          } else if (value === "差戻し") {
            mapped.status = "差戻し";
          }
          updatedFields.push(key);
          break;
        case "発注ステータス":
          if (value === "発注済") {
            mapped.status = "発注済";
            mapped.orderedAt = new Date();
          }
          updatedFields.push(key);
          break;
        case "検収ステータス":
          if (value === "検収済") {
            mapped.status = "検収済";
            mapped.inspectedAt = new Date();
          }
          updatedFields.push(key);
          break;
        case "検収日":
          mapped.inspectedAt = value ? new Date(value) : null;
          updatedFields.push(key);
          break;
        case "証憑対応":
          mapped.voucherStatus = value;
          updatedFields.push(key);
          break;
        case "勘定科目":
          mapped.accountTitle = value;
          updatedFields.push(key);
          break;
        case "適格番号":
        case "登録番号":
          mapped.registrationNumber = value;
          updatedFields.push(key);
          break;
        case "納品書":
          mapped.deliveryNoteFileUrl = value;
          updatedFields.push(key);
          break;
        case "備考":
          mapped.remarks = value;
          updatedFields.push(key);
          break;
        default:
          // 未マッピングは無視してログ
          console.warn(`[db-client] updateStatus: unknown field "${key}"`);
      }
    }

    // 監査ログ用に更新前の値を取得（楽観的ロックにも使用）
    const [oldRow] = await db
      .select({ status: purchaseRequests.status, updatedAt: purchaseRequests.updatedAt })
      .from(purchaseRequests)
      .where(eq(purchaseRequests.poNumber, prNumber))
      .limit(1);

    // 楽観的ロック: updatedAtが一致する行のみ更新（競合検出）
    const conditions = [eq(purchaseRequests.poNumber, prNumber)];
    if (oldRow?.updatedAt) {
      conditions.push(eq(purchaseRequests.updatedAt, oldRow.updatedAt));
    }
    const result = await db
      .update(purchaseRequests)
      .set(mapped)
      .where(and(...conditions))
      .returning({ poNumber: purchaseRequests.poNumber });

    if (result.length === 0) {
      // oldRowが存在するなら楽観的ロック競合、存在しないなら未発見
      if (oldRow) {
        console.warn(`[db-client] updateStatus: optimistic lock conflict for ${prNumber}`);
        return ng(`${prNumber} は他の操作で更新されました。再度お試しください`, 409);
      }
      return ng(`PO番号 ${prNumber} が見つかりません`, 404);
    }

    // 監査ログ記録（ステータス変更時）
    if (mapped.status && oldRow && oldRow.status !== mapped.status) {
      writeAuditLog([{
        tableName: "purchase_requests",
        recordId: prNumber,
        action: "updated",
        fieldName: "status",
        oldValue: oldRow.status ?? undefined,
        newValue: mapped.status,
        metadata: { updatedFields, source: "updateStatus" },
      }]).catch(() => {}); // fire-and-forget
    }

    // キャッシュ無効化
    const { cacheDelete } = await import("../cache");
    cacheDelete(`purchase:${prNumber}`);
    await invalidateRecentRequests();

    return ok({ prNumber, rowNumber: 0, updatedFields });
  } catch (e) {
    return ng(e instanceof Error ? e.message : String(e));
  }
}
