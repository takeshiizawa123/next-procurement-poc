/**
 * DB Client — 型定義・ヘルパー・定数
 */

import { sharedCacheDeleteByPrefix } from "../shared-cache";

// ===========================================
// 型エイリアス（gas-client互換）
// ===========================================

export interface DbResponse<T = Record<string, unknown>> {
  success: boolean;
  data: T | null;
  error: string | null;
  statusCode: number;
  timestamp: string;
}

// GasResponseとの互換（既存呼び出し元がGasResponseを期待する場合）
export type GasResponse<T = Record<string, unknown>> = DbResponse<T>;

export interface RegisterResult {
  prNumber: string;
  rowNumber: number;
}

export interface UpdateResult {
  prNumber: string;
  rowNumber: number;
  updatedFields: string[];
}

export type PurchaseStatus = Record<string, unknown> & {
  購買番号: string;
  発注承認ステータス: string;
  発注ステータス: string;
  検収ステータス: string;
  _rowNumber: number;
};

export interface Employee {
  name: string;
  departmentCode: string;
  departmentName: string;
  slackAliases: string;
  slackId: string;
  deptHeadSlackId: string;
}

export interface DuplicateResult {
  prNumber: string;
  itemName: string;
  totalAmount: number;
  applicationDate: string;
  applicant: string;
  status: string;
}

export interface PastRequest {
  prNumber: string;
  applicationDate: string;
  itemName: string;
  totalAmount: number;
  unitPrice: number;
  quantity: number;
  supplierName: string;
  supplierUrl: string;
  applicant: string;
  paymentMethod: string;
  purpose: string;
  approvalStatus: string;
  orderStatus: string;
  inspectionStatus: string;
  voucherStatus: string;
  slackLink?: string;
  type: string;
  department: string;
  accountTitle: string;
  hubspotInfo?: string;
  voucherType?: string;
  journalId?: string;
  remarks?: string;
  inspectionDate?: string;
  registrationNumber?: string;
  isQualifiedInvoice?: string;
  invoiceVerificationStatus?: string;
}

export interface PendingVoucher {
  prNumber: string;
  itemName: string;
  totalAmount: number;
  applicationDate: string;
  daysElapsed: number;
}

// ===========================================
// 定数
// ===========================================

export const DB_SHORT_TTL = 3 * 60_000; // 3分（employees, suppliers, recentRequests）
export const DB_MASTER_TTL = 4 * 60 * 60_000; // 4時間（MFマスタ）
export const DB_STATS_TTL = 60 * 60_000; // 1時間

// ===========================================
// ヘルパー関数
// ===========================================

export function ok<T>(data: T): DbResponse<T> {
  return {
    success: true,
    data,
    error: null,
    statusCode: 200,
    timestamp: new Date().toISOString(),
  };
}

export function ng<T = never>(error: string, statusCode = 500): DbResponse<T> {
  return {
    success: false,
    data: null,
    error,
    statusCode,
    timestamp: new Date().toISOString(),
  };
}

// ===========================================
// ステータス派生関数（複数repoから利用）
// ===========================================

// DB enum: 申請済 / 承認済 / 発注済 / 検収済 / 証憑完了 / 計上済 / 支払済 / 差戻し / 取消
// UI は「承認/発注/検収/証憑」の4軸に分解された形式を期待する

export function deriveApprovalStatus(status: string): string {
  if (status === "申請済") return "承認待ち";
  if (status === "差戻し") return "差戻し";
  if (status === "取消") return "取消";
  return "承認済";
}

export function deriveOrderStatus(status: string): string {
  if (["申請済", "承認済", "差戻し", "取消"].includes(status)) return "未発注";
  return "発注済";
}

/**
 * DB enum → フロントエンド互換の日本語値に変換
 *
 * フロントエンドは旧GAS時代の日本語値（"要取得", "添付済", "MF自動取得"）を期待する。
 * 検収前は voucher_status が "none" でも UI 上は "未検収" 状態なので変換しない。
 *
 * 注意: "uploaded" と "verified" はいずれも「証憑添付済み」として UI では同じ扱い。
 */
export function deriveVoucherStatus(voucherStatus: string, status: string): string {
  // 検収前は証憑対応もまだ不要 → "未対応"として返す
  if (["申請済", "承認済", "発注済", "差戻し", "取消"].includes(status)) {
    return "未対応";
  }
  // 検収以降の voucher_status を日本語値に変換
  switch (voucherStatus) {
    case "none":
      return "要取得";
    case "uploaded":
    case "verified":
      return "添付済"; // UIは両者を区別しないため同じ値に
    case "mf_auto":
      return "MF自動取得";
    default:
      return voucherStatus;
  }
}

export function deriveInspectionStatus(status: string): string {
  if (["申請済", "承認済", "発注済", "差戻し", "取消"].includes(status)) return "未検収";
  return "検収済";
}

// ===========================================
// キャッシュ無効化
// ===========================================

/** 過去申請キャッシュを無効化 */
export async function invalidateRecentRequests(): Promise<void> {
  await sharedCacheDeleteByPrefix("db:recentRequests:");
}

// ===========================================
// PurchaseRequest → PastRequest 変換
// ===========================================

import type { PurchaseRequest } from "@/db/schema";

/**
 * DBレコードをPastRequest形式に変換（既存API互換）
 */
export function toPastRequest(row: PurchaseRequest): PastRequest {
  return {
    prNumber: row.poNumber,
    applicationDate: row.applicationDate?.toISOString() ?? "",
    itemName: row.itemName,
    totalAmount: row.totalAmount,
    unitPrice: row.unitPrice,
    quantity: row.quantity,
    supplierName: row.supplierName ?? "",
    supplierUrl: row.supplierUrl ?? "",
    applicant: row.applicantName,
    paymentMethod: row.paymentMethod,
    purpose: row.purpose ?? "",
    approvalStatus: deriveApprovalStatus(row.status),
    orderStatus: deriveOrderStatus(row.status),
    inspectionStatus: deriveInspectionStatus(row.status),
    voucherStatus: deriveVoucherStatus(row.voucherStatus, row.status),
    // UI 互換: DB の "購入済" → レガシー UI では "購入報告" として特殊表示される
    type: row.requestType === "購入済" ? "購入報告" : row.requestType,
    department: row.department,
    accountTitle: row.accountTitle ?? "",
    hubspotInfo: row.hubspotDealId ?? undefined,
    remarks: row.remarks ?? undefined,
    inspectionDate: row.inspectedAt?.toISOString() ?? undefined,
    registrationNumber: row.registrationNumber ?? undefined,
    isQualifiedInvoice: row.isQualifiedInvoice ?? undefined,
    invoiceVerificationStatus: row.invoiceVerificationStatus ?? undefined,
  };
}
