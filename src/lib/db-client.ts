/**
 * DB Client — gas-client.tsのDrizzle版実装
 *
 * 既存gas-client.tsと同じ関数名・シグネチャを維持し、呼び出し側を変えずに置換可能にする。
 * 内部実装はSupabase Postgres + Drizzle ORMに置き換え。
 *
 * 移行戦略:
 * 1. このファイルを作成（現段階）
 * 2. 既存呼び出し元を gas-client → db-client に1つずつ切り替え
 * 3. 全切り替え完了後、gas-client.tsを削除
 */

import { and, desc, eq, gte, like, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  purchaseRequests,
  predictedTransactions,
  mfCounterparties,
  mfDepartments,
  mfAccounts,
  mfTaxes,
  mfSubAccounts,
  mfProjects,
  mfMastersCache,
  purchaseDrafts,
  journalStats,
  journalRows,
  accountCorrections,
  type PurchaseRequest,
  type NewPurchaseRequest,
} from "@/db/schema";
import { cachedFetch, sharedCacheDeleteByPrefix } from "./shared-cache";

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
// ヘルパー
// ===========================================

const DB_SHORT_TTL = 3 * 60_000; // 3分（employees, suppliers, recentRequests）
const DB_MASTER_TTL = 4 * 60 * 60_000; // 4時間（MFマスタ）
const DB_STATS_TTL = 60 * 60_000; // 1時間

function ok<T>(data: T): DbResponse<T> {
  return {
    success: true,
    data,
    error: null,
    statusCode: 200,
    timestamp: new Date().toISOString(),
  };
}

function ng<T = never>(error: string, statusCode = 500): DbResponse<T> {
  return {
    success: false,
    data: null,
    error,
    statusCode,
    timestamp: new Date().toISOString(),
  };
}

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
 * DBレコードをPastRequest形式に変換（既存API互換）
 */
function toPastRequest(row: PurchaseRequest): PastRequest {
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

// ステータス派生（既存UIの期待する形式に合わせる）
//
// DB enum: 申請済 / 承認済 / 発注済 / 検収済 / 証憑完了 / 計上済 / 支払済 / 差戻し / 取消
// UI は「承認/発注/検収/証憑」の4軸に分解された形式を期待する

function deriveApprovalStatus(status: string): string {
  if (status === "申請済") return "承認待ち";
  if (status === "差戻し") return "差戻し";
  if (status === "取消") return "取消";
  return "承認済";
}

function deriveOrderStatus(status: string): string {
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
function deriveVoucherStatus(voucherStatus: string, status: string): string {
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

function deriveInspectionStatus(status: string): string {
  if (["申請済", "承認済", "発注済", "差戻し", "取消"].includes(status)) return "未検収";
  return "検収済";
}

// ===========================================
// 購買申請（registerPurchase, getStatus, updateStatus）
// ===========================================

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

    const result = await db
      .update(purchaseRequests)
      .set(mapped)
      .where(eq(purchaseRequests.poNumber, prNumber))
      .returning({ poNumber: purchaseRequests.poNumber });

    if (result.length === 0) {
      return ng(`PO番号 ${prNumber} が見つかりません`, 404);
    }

    // キャッシュ無効化
    const { cacheDelete } = await import("./cache");
    cacheDelete(`purchase:${prNumber}`);
    await invalidateRecentRequests();

    return ok({ prNumber, rowNumber: 0, updatedFields });
  } catch (e) {
    return ng(e instanceof Error ? e.message : String(e));
  }
}

// ===========================================
// 従業員マスタ
// ===========================================

/**
 * 従業員マスタ一覧を取得（3分キャッシュ + リクエスト合体）
 */
export async function getEmployees(): Promise<DbResponse<{ employees: Employee[] }>> {
  return cachedFetch("db:employees", DB_SHORT_TTL, async () => {
    try {
      const rows = await db.select().from(employees).where(eq(employees.isActive, true));
      const list: Employee[] = rows.map((r) => ({
        name: r.name,
        departmentCode: r.departmentCode,
        departmentName: r.departmentName,
        slackAliases: r.slackAliases ?? "",
        slackId: r.slackId,
        deptHeadSlackId: r.deptHeadSlackId ?? "",
      }));
      return ok({ employees: list });
    } catch (e) {
      return ng<{ employees: Employee[] }>(e instanceof Error ? e.message : String(e));
    }
  });
}

/**
 * 従業員の承認者（部門長SlackID）を更新
 */
export async function updateApprover(
  employeeName: string,
  deptHeadSlackId: string,
): Promise<DbResponse<{ updated: boolean }>> {
  try {
    await db
      .update(employees)
      .set({ deptHeadSlackId, updatedAt: new Date() })
      .where(eq(employees.name, employeeName));
    await sharedCacheDeleteByPrefix("db:employees");
    return ok({ updated: true });
  } catch (e) {
    return ng(e instanceof Error ? e.message : String(e));
  }
}

// ===========================================
// 過去申請（recentRequests, checkDuplicate, suppliers）
// ===========================================

/**
 * 過去申請一覧を取得
 */
export async function getRecentRequests(
  applicant?: string,
  limit?: number,
): Promise<DbResponse<{ requests: PastRequest[] }>> {
  const cacheKey = `db:recentRequests:${applicant || "all"}:${limit || 30}`;
  return cachedFetch(cacheKey, DB_SHORT_TTL, async () => {
    try {
      const where = applicant ? eq(purchaseRequests.applicantName, applicant) : undefined;
      const rows = await db
        .select()
        .from(purchaseRequests)
        .where(where)
        .orderBy(desc(purchaseRequests.applicationDate))
        .limit(limit ?? 30);
      return ok({ requests: rows.map(toPastRequest) });
    } catch (e) {
      return ng<{ requests: PastRequest[] }>(e instanceof Error ? e.message : String(e));
    }
  });
}

/** 過去申請キャッシュを無効化 */
export async function invalidateRecentRequests(): Promise<void> {
  await sharedCacheDeleteByPrefix("db:recentRequests:");
}

/**
 * 重複チェック
 */
export async function checkDuplicate(
  itemName: string,
  totalAmount?: number,
): Promise<DbResponse<{ duplicates: DuplicateResult[] }>> {
  try {
    // 直近30日の類似申請を検索
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const where = and(
      like(purchaseRequests.itemName, `%${itemName}%`),
      gte(purchaseRequests.applicationDate, thirtyDaysAgo),
      totalAmount ? eq(purchaseRequests.totalAmount, totalAmount) : undefined,
    );
    const rows = await db.select().from(purchaseRequests).where(where).limit(10);
    const duplicates: DuplicateResult[] = rows.map((r) => ({
      prNumber: r.poNumber,
      itemName: r.itemName,
      totalAmount: r.totalAmount,
      applicationDate: r.applicationDate?.toISOString() ?? "",
      applicant: r.applicantName,
      status: r.status,
    }));
    return ok({ duplicates });
  } catch (e) {
    return ng(e instanceof Error ? e.message : String(e));
  }
}

/**
 * 購入先名一覧を取得
 */
export async function getSuppliers(): Promise<DbResponse<{ suppliers: string[] }>> {
  return cachedFetch("db:suppliers", DB_SHORT_TTL, async () => {
    try {
      const rows = await db
        .selectDistinct({ supplier: purchaseRequests.supplierName })
        .from(purchaseRequests)
        .where(sql`${purchaseRequests.supplierName} IS NOT NULL`);
      return ok({ suppliers: rows.map((r) => r.supplier).filter((s): s is string => !!s) });
    } catch (e) {
      return ng<{ suppliers: string[] }>(e instanceof Error ? e.message : String(e));
    }
  });
}

/**
 * 証憑未提出一覧を取得
 */
export async function getPendingVouchers(
  applicant: string,
): Promise<DbResponse<{ pending: PendingVoucher[] }>> {
  try {
    const rows = await db
      .select()
      .from(purchaseRequests)
      .where(
        and(
          eq(purchaseRequests.applicantName, applicant),
          eq(purchaseRequests.voucherStatus, "none"),
        ),
      )
      .orderBy(desc(purchaseRequests.applicationDate));
    const pending: PendingVoucher[] = rows.map((r) => {
      const days = r.applicationDate
        ? Math.floor((Date.now() - r.applicationDate.getTime()) / (24 * 60 * 60 * 1000))
        : 0;
      return {
        prNumber: r.poNumber,
        itemName: r.itemName,
        totalAmount: r.totalAmount,
        applicationDate: r.applicationDate?.toISOString() ?? "",
        daysElapsed: days,
      };
    });
    return ok({ pending });
  } catch (e) {
    return ng(e instanceof Error ? e.message : String(e));
  }
}

/**
 * DB接続テスト
 */
export async function testConnection(): Promise<DbResponse<{ status: string; version: string }>> {
  try {
    const result = await db.execute(sql`SELECT version() as version`);
    const version = (result[0] as { version: string })?.version ?? "unknown";
    return ok({ status: "ok", version });
  } catch (e) {
    return ng(e instanceof Error ? e.message : String(e));
  }
}

// ===========================================
// 予測テーブル
// ===========================================

export interface PredictedTxInput {
  id: string;
  po_number: string;
  type: string; // "purchase" | "trip_transport" | "trip_hotel" | "trip_daily"
  card_last4: string;
  predicted_amount: number;
  predicted_date: string;
  supplier: string;
  applicant: string;
  applicant_slack_id?: string;
  stage1_journal_id?: number;
  status?: string;
  is_estimate?: boolean;
  is_post_report?: boolean;
  emergency_reason?: string;
  // 旧gas-client互換用（DB側では使わない）
  created_at?: string;
  matched_journal_id?: number;
  matched_at?: string;
  amount_diff?: number;
}

export interface PredictedTxOutput {
  id: string;
  po_number: string;
  type: string;
  card_last4: string;
  predicted_amount: number;
  predicted_date: string;
  supplier: string;
  applicant: string;
  applicant_slack_id?: string;
  stage1_journal_id?: number;
  status: string;
  matched_journal_id?: number;
  matched_at?: string;
  amount_diff?: number;
  created_at: string;
  is_estimate?: boolean;
  is_post_report?: boolean;
  emergency_reason?: string;
}

/**
 * 予測テーブルを取得（月指定）
 */
export async function getPredictedTransactions(
  month: string, // "2026-03"
): Promise<DbResponse<{ predictions: PredictedTxOutput[] }>> {
  try {
    const [year, mo] = month.split("-").map((s) => parseInt(s, 10));
    const start = new Date(year, mo - 1, 1);
    const end = new Date(year, mo, 1);

    const rows = await db
      .select()
      .from(predictedTransactions)
      .where(
        and(
          gte(predictedTransactions.predictedDate, start.toISOString().slice(0, 10)),
          sql`${predictedTransactions.predictedDate} < ${end.toISOString().slice(0, 10)}`,
        ),
      )
      .orderBy(desc(predictedTransactions.predictedDate));

    const predictions: PredictedTxOutput[] = rows.map((r) => ({
      id: r.id,
      po_number: r.poNumber ?? "",
      type: r.type,
      card_last4: r.cardLast4 ?? "",
      predicted_amount: r.predictedAmount,
      predicted_date: r.predictedDate,
      supplier: r.supplier ?? "",
      applicant: r.applicant ?? "",
      applicant_slack_id: r.applicantSlackId ?? undefined,
      status: r.status,
      matched_journal_id: r.matchedJournalId ?? undefined,
      matched_at: r.matchedAt?.toISOString(),
      amount_diff: r.amountDiff ?? undefined,
      is_estimate: r.isEstimate,
      is_post_report: r.isPostReport,
      emergency_reason: r.emergencyReason ?? undefined,
      created_at: r.createdAt.toISOString(),
    }));
    return ok({ predictions });
  } catch (e) {
    return ng(e instanceof Error ? e.message : String(e));
  }
}

/**
 * 予測テーブルに新規レコードを追加
 */
export async function createPrediction(
  prediction: PredictedTxInput,
): Promise<DbResponse<{ id: string }>> {
  try {
    await db.insert(predictedTransactions).values({
      id: prediction.id,
      poNumber: prediction.po_number,
      type: prediction.type as "purchase" | "trip_transport" | "trip_hotel" | "trip_daily" | "reimbursement",
      cardLast4: prediction.card_last4 ?? null,
      predictedAmount: prediction.predicted_amount,
      predictedDate: prediction.predicted_date,
      supplier: prediction.supplier,
      applicant: prediction.applicant,
      applicantSlackId: prediction.applicant_slack_id ?? null,
      status: (prediction.status ?? "pending") as "pending" | "matched" | "unmatched" | "cancelled",
      isEstimate: prediction.is_estimate ?? false,
      isPostReport: prediction.is_post_report ?? false,
      emergencyReason: prediction.emergency_reason ?? null,
    });
    return ok({ id: prediction.id });
  } catch (e) {
    return ng(e instanceof Error ? e.message : String(e));
  }
}

/**
 * 予測テーブルのステータスを更新
 */
export async function updatePredictionStatus(
  predictionId: string,
  updates: {
    status?: "pending" | "matched" | "unmatched" | "cancelled";
    matched_journal_id?: number;
    matched_at?: string;
    amount_diff?: number;
  },
): Promise<DbResponse<{ id: string }>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped: Record<string, any> = {};
    if (updates.status) mapped.status = updates.status;
    if (updates.matched_journal_id !== undefined) mapped.matchedJournalId = updates.matched_journal_id;
    if (updates.matched_at) mapped.matchedAt = new Date(updates.matched_at);
    if (updates.amount_diff !== undefined) mapped.amountDiff = updates.amount_diff;

    await db.update(predictedTransactions).set(mapped).where(eq(predictedTransactions.id, predictionId));
    return ok({ id: predictionId });
  } catch (e) {
    return ng(e instanceof Error ? e.message : String(e));
  }
}

export interface EmployeeCard {
  name: string;
  slackId: string;
  card_last4: string;
  card_holder_name: string;
}

/**
 * 従業員マスタ（カード情報付き）を取得
 */
export async function getEmployeeCards(): Promise<DbResponse<{ employees: EmployeeCard[] }>> {
  try {
    const rows = await db
      .select({
        name: employees.name,
        slackId: employees.slackId,
        cardLast4: employees.cardLast4,
        cardHolderName: employees.cardHolderName,
      })
      .from(employees)
      .where(and(eq(employees.isActive, true), sql`${employees.cardLast4} IS NOT NULL`));
    const list: EmployeeCard[] = rows.map((r) => ({
      name: r.name,
      slackId: r.slackId,
      card_last4: r.cardLast4 ?? "",
      card_holder_name: r.cardHolderName ?? "",
    }));
    return ok({ employees: list });
  } catch (e) {
    return ng(e instanceof Error ? e.message : String(e));
  }
}

// ===========================================
// MFマスタ
// ===========================================

export interface GasCounterparty {
  mfId: string;
  code: string;
  name: string;
  searchKey: string;
  invoiceRegistrationNumber: string;
  available: boolean;
  alias: string;
}

export interface GasDepartment {
  mfId: string;
  code: string;
  name: string;
  searchKey: string;
  available: boolean;
}

export interface GasAccount {
  mfId: string;
  code: string;
  name: string;
  searchKey: string;
  taxId: number | null;
  available: boolean;
}

export interface GasTax {
  mfId: string;
  code: string;
  name: string;
  abbreviation: string;
  taxRate: number | null;
  available: boolean;
}

export interface GasSubAccount {
  mfId: string;
  code: string;
  accountId: number | null;
  name: string;
  searchKey: string;
  available: boolean;
}

export interface GasProject {
  mfId: string;
  code: string;
  name: string;
  searchKey: string;
  available: boolean;
}

export async function getGasCounterparties(): Promise<DbResponse<{ counterparties: GasCounterparty[] }>> {
  return cachedFetch("db:mfCounterparties", DB_MASTER_TTL, async () => {
    try {
      const rows = await db.select().from(mfCounterparties);
      const counterparties: GasCounterparty[] = rows.map((r) => ({
        mfId: r.mfId,
        code: r.code,
        name: r.name,
        searchKey: r.searchKey ?? "",
        invoiceRegistrationNumber: r.invoiceRegistrationNumber ?? "",
        available: r.available,
        alias: r.alias ?? "",
      }));
      return ok({ counterparties });
    } catch (e) {
      return ng<{ counterparties: GasCounterparty[] }>(e instanceof Error ? e.message : String(e));
    }
  });
}

export async function getGasDepartments(): Promise<DbResponse<{ departments: GasDepartment[] }>> {
  return cachedFetch("db:mfDepartments", DB_MASTER_TTL, async () => {
    try {
      const rows = await db.select().from(mfDepartments);
      const departments: GasDepartment[] = rows.map((r) => ({
        mfId: r.mfId,
        code: r.code,
        name: r.name,
        searchKey: r.searchKey ?? "",
        available: r.available,
      }));
      return ok({ departments });
    } catch (e) {
      return ng<{ departments: GasDepartment[] }>(e instanceof Error ? e.message : String(e));
    }
  });
}

export async function getGasAccounts(): Promise<DbResponse<{ accounts: GasAccount[] }>> {
  return cachedFetch("db:mfAccounts", DB_MASTER_TTL, async () => {
    try {
      const rows = await db.select().from(mfAccounts);
      const accounts: GasAccount[] = rows.map((r) => ({
        mfId: r.mfId,
        code: r.code,
        name: r.name,
        searchKey: r.searchKey ?? "",
        taxId: r.taxId,
        available: r.available,
      }));
      return ok({ accounts });
    } catch (e) {
      return ng<{ accounts: GasAccount[] }>(e instanceof Error ? e.message : String(e));
    }
  });
}

export async function getGasTaxes(): Promise<DbResponse<{ taxes: GasTax[] }>> {
  return cachedFetch("db:mfTaxes", DB_MASTER_TTL, async () => {
    try {
      const rows = await db.select().from(mfTaxes);
      const taxes: GasTax[] = rows.map((r) => ({
        mfId: r.mfId,
        code: r.code,
        name: r.name,
        abbreviation: r.abbreviation ?? "",
        taxRate: r.taxRate !== null ? r.taxRate / 100 : null, // 1000 → 10.0
        available: r.available,
      }));
      return ok({ taxes });
    } catch (e) {
      return ng<{ taxes: GasTax[] }>(e instanceof Error ? e.message : String(e));
    }
  });
}

export async function getGasSubAccounts(): Promise<DbResponse<{ subAccounts: GasSubAccount[] }>> {
  return cachedFetch("db:mfSubAccounts", DB_MASTER_TTL, async () => {
    try {
      const rows = await db.select().from(mfSubAccounts);
      const subAccounts: GasSubAccount[] = rows.map((r) => ({
        mfId: r.mfId,
        code: r.code,
        accountId: r.accountId,
        name: r.name,
        searchKey: r.searchKey ?? "",
        available: r.available,
      }));
      return ok({ subAccounts });
    } catch (e) {
      return ng<{ subAccounts: GasSubAccount[] }>(e instanceof Error ? e.message : String(e));
    }
  });
}

export async function getGasProjects(): Promise<DbResponse<{ projects: GasProject[] }>> {
  return cachedFetch("db:mfProjects", DB_MASTER_TTL, async () => {
    try {
      const rows = await db.select().from(mfProjects);
      const projects: GasProject[] = rows.map((r) => ({
        mfId: r.mfId,
        code: r.code,
        name: r.name,
        searchKey: r.searchKey ?? "",
        available: r.available,
      }));
      return ok({ projects });
    } catch (e) {
      return ng<{ projects: GasProject[] }>(e instanceof Error ? e.message : String(e));
    }
  });
}

export interface MastersBundle {
  accounts: GasAccount[];
  taxes: GasTax[];
  departments: GasDepartment[];
  subAccounts: GasSubAccount[];
  projects: GasProject[];
  counterparties: GasCounterparty[];
}

/**
 * 全マスタを1クエリで一括取得
 */
export async function getMastersBundle(): Promise<DbResponse<MastersBundle>> {
  return cachedFetch("db:mastersBundle", DB_MASTER_TTL, async () => {
    try {
      const [a, t, d, s, p, c] = await Promise.all([
        getGasAccounts(),
        getGasTaxes(),
        getGasDepartments(),
        getGasSubAccounts(),
        getGasProjects(),
        getGasCounterparties(),
      ]);
      return ok({
        accounts: a.data?.accounts ?? [],
        taxes: t.data?.taxes ?? [],
        departments: d.data?.departments ?? [],
        subAccounts: s.data?.subAccounts ?? [],
        projects: p.data?.projects ?? [],
        counterparties: c.data?.counterparties ?? [],
      });
    } catch (e) {
      return ng<MastersBundle>(e instanceof Error ? e.message : String(e));
    }
  });
}

// ===========================================
// 仕訳統計・原票検索
// ===========================================

export interface CounterpartyAccountStat {
  counterparty: string;
  account: string;
  taxType: string;
  count: number;
}

export interface DeptAccountTaxStat {
  department: string;
  account: string;
  taxType: string;
  count: number;
}

export interface RemarkAccountStat {
  keyword: string;
  account: string;
  taxType: string;
  count: number;
}

export interface JournalStats {
  counterpartyAccounts: CounterpartyAccountStat[];
  deptAccountTax: DeptAccountTaxStat[];
  remarkAccounts: RemarkAccountStat[];
  totalJournals: number;
  totalRows: number;
  computedAt: string;
}

/**
 * 仕訳統計を取得（1時間キャッシュ）
 */
export async function getJournalStats(): Promise<JournalStats | null> {
  try {
    const result = await cachedFetch("db:journalStats", DB_STATS_TTL, async () => {
      const rows = await db.select().from(journalStats).limit(1);
      if (rows.length === 0) return null;
      const r = rows[0];
      return {
        counterpartyAccounts: (r.counterpartyAccounts as CounterpartyAccountStat[]) ?? [],
        deptAccountTax: (r.deptAccountTax as DeptAccountTaxStat[]) ?? [],
        remarkAccounts: (r.remarkAccounts as RemarkAccountStat[]) ?? [],
        totalJournals: r.totalJournals ?? 0,
        totalRows: r.totalRows ?? 0,
        computedAt: r.computedAt.toISOString(),
      } as JournalStats;
    });
    return result;
  } catch (e) {
    console.warn("[db-client] getJournalStats failed:", e);
    return null;
  }
}

export interface JournalRow {
  date: string;
  remark: string;
  account: string;
  taxType: string;
  amount: number;
  department: string;
  counterparty: string;
}

export interface JournalRowsResult {
  supplierMatches: JournalRow[];
  keywordMatches: JournalRow[];
}

/**
 * 過去仕訳の原票を取引先・品名キーワードで検索
 */
export async function searchJournalRows(
  supplier: string,
  keyword: string,
): Promise<JournalRowsResult | null> {
  try {
    const [supplierRows, keywordRows] = await Promise.all([
      supplier
        ? db
            .select()
            .from(journalRows)
            .where(like(journalRows.counterparty, `%${supplier}%`))
            .limit(50)
        : Promise.resolve([]),
      keyword
        ? db
            .select()
            .from(journalRows)
            .where(like(journalRows.remark, `%${keyword}%`))
            .limit(50)
        : Promise.resolve([]),
    ]);

    const toRow = (r: typeof journalRows.$inferSelect): JournalRow => ({
      date: r.date,
      remark: r.remark ?? "",
      account: r.account ?? "",
      taxType: r.taxType ?? "",
      amount: r.amount ?? 0,
      department: r.department ?? "",
      counterparty: r.counterparty ?? "",
    });

    return {
      supplierMatches: supplierRows.map(toRow),
      keywordMatches: keywordRows.map(toRow),
    };
  } catch (e) {
    console.warn("[db-client] searchJournalRows failed:", e);
    return null;
  }
}

// ===========================================
// MFマスタJSONキャッシュ
// ===========================================

export interface MfMastersCache {
  accounts: { code: string | null; name: string; taxId?: number }[];
  taxes: { code: string | null; name: string; abbreviation?: string; taxRate?: number }[];
  subAccounts: { id: number; accountId: number; name: string }[];
  projects: { code: string | null; name: string }[];
  syncedAt: string;
}

export async function saveMfMasters(masters: MfMastersCache): Promise<DbResponse<{ saved: boolean }>> {
  try {
    await db
      .insert(mfMastersCache)
      .values({
        id: "mf_masters",
        accounts: masters.accounts,
        taxes: masters.taxes,
        subAccounts: masters.subAccounts,
        projects: masters.projects,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: mfMastersCache.id,
        set: {
          accounts: masters.accounts,
          taxes: masters.taxes,
          subAccounts: masters.subAccounts,
          projects: masters.projects,
          syncedAt: new Date(),
        },
      });
    return ok({ saved: true });
  } catch (e) {
    return ng(e instanceof Error ? e.message : String(e));
  }
}

export async function getMfMasters(): Promise<DbResponse<{ masters: MfMastersCache }>> {
  try {
    const rows = await db.select().from(mfMastersCache).where(eq(mfMastersCache.id, "mf_masters")).limit(1);
    if (rows.length === 0) {
      return ng("MFマスタキャッシュが存在しません", 404);
    }
    const r = rows[0];
    return ok({
      masters: {
        accounts: (r.accounts as MfMastersCache["accounts"]) ?? [],
        taxes: (r.taxes as MfMastersCache["taxes"]) ?? [],
        subAccounts: (r.subAccounts as MfMastersCache["subAccounts"]) ?? [],
        projects: (r.projects as MfMastersCache["projects"]) ?? [],
        syncedAt: r.syncedAt.toISOString(),
      },
    });
  } catch (e) {
    return ng(e instanceof Error ? e.message : String(e));
  }
}

// ===========================================
// 下書き保存
// ===========================================

export async function savePurchaseDraft(
  userId: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(purchaseDrafts).values({
      userId,
      draft: data,
    });
  } catch (e) {
    console.warn("[db-client] savePurchaseDraft failed:", e);
  }
}

export async function loadPurchaseDraft(
  userId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const rows = await db
      .select()
      .from(purchaseDrafts)
      .where(eq(purchaseDrafts.userId, userId))
      .orderBy(desc(purchaseDrafts.savedAt))
      .limit(1);
    return rows[0]?.draft as Record<string, unknown> | null ?? null;
  } catch (e) {
    console.warn("[db-client] loadPurchaseDraft failed:", e);
    return null;
  }
}

export async function clearPurchaseDraft(userId: string): Promise<void> {
  try {
    await db.delete(purchaseDrafts).where(eq(purchaseDrafts.userId, userId));
  } catch (e) {
    console.warn("[db-client] clearPurchaseDraft failed:", e);
  }
}

// ===========================================
// 勘定科目修正履歴
// ===========================================

export interface CorrectionRecord {
  itemName: string;
  supplierName: string | null;
  estimatedAccount: string;
  correctedAccount: string;
  correctedTaxType: string | null;
}

/**
 * 取引先・品目名に関連する過去の修正履歴を取得（RAGコンテキスト用）
 */
export async function getAccountCorrections(
  supplier: string,
  keyword: string,
): Promise<CorrectionRecord[]> {
  try {
    const conditions = [];
    if (supplier) conditions.push(like(accountCorrections.supplierName, `%${supplier}%`));
    if (keyword) conditions.push(like(accountCorrections.itemName, `%${keyword}%`));
    if (conditions.length === 0) return [];

    const rows = await db
      .select({
        itemName: accountCorrections.itemName,
        supplierName: accountCorrections.supplierName,
        estimatedAccount: accountCorrections.estimatedAccount,
        correctedAccount: accountCorrections.correctedAccount,
        correctedTaxType: accountCorrections.correctedTaxType,
      })
      .from(accountCorrections)
      .where(or(...conditions))
      .orderBy(desc(accountCorrections.createdAt))
      .limit(20);

    return rows;
  } catch (e) {
    console.warn("[db-client] getAccountCorrections failed:", e);
    return [];
  }
}
