/**
 * DB Client Facade — ドメイン別モジュールの統一re-export
 *
 * 既存の import { xxx } from "@/lib/db-client" はすべてこのファイル経由で動作。
 * 実装は src/lib/db/*.ts に分割されている。
 */

// ===========================================
// 型・ヘルパー・定数（types.ts）
// ===========================================
export type {
  DbResponse,
  GasResponse,
  RegisterResult,
  UpdateResult,
  PurchaseStatus,
  Employee,
  DuplicateResult,
  PastRequest,
  PendingVoucher,
} from "./db/types";

export {
  ok,
  ng,
  DB_SHORT_TTL,
  DB_MASTER_TTL,
  DB_STATS_TTL,
  deriveApprovalStatus,
  deriveOrderStatus,
  deriveVoucherStatus,
  deriveInspectionStatus,
  invalidateRecentRequests,
  toPastRequest,
} from "./db/types";

// ===========================================
// 購買申請（purchase-repo.ts）
// ===========================================
export {
  registerPurchase,
  getStatus,
  updateStatus,
} from "./db/purchase-repo";

// ===========================================
// 従業員マスタ（employee-repo.ts）
// ===========================================
export {
  getEmployees,
  updateApprover,
} from "./db/employee-repo";

// ===========================================
// 過去申請・検索（request-repo.ts）
// ===========================================
export {
  getRecentRequests,
  checkDuplicate,
  getSuppliers,
  getPendingVouchers,
  testConnection,
} from "./db/request-repo";

// ===========================================
// 予測テーブル（prediction-repo.ts）
// ===========================================
export type {
  PredictedTxInput,
  PredictedTxOutput,
  EmployeeCard,
} from "./db/prediction-repo";

export {
  getPredictedTransactions,
  createPrediction,
  updatePredictionStatus,
  getEmployeeCards,
} from "./db/prediction-repo";

// ===========================================
// MFマスタ・仕訳統計（master-repo.ts）
// ===========================================
export type {
  GasCounterparty,
  GasDepartment,
  GasAccount,
  GasTax,
  GasSubAccount,
  GasProject,
  MastersBundle,
  CounterpartyAccountStat,
  DeptAccountTaxStat,
  RemarkAccountStat,
  JournalStats,
  JournalRow,
  JournalRowsResult,
  MfMastersCache,
} from "./db/master-repo";

export {
  getGasCounterparties,
  getGasDepartments,
  getGasAccounts,
  getGasTaxes,
  getGasSubAccounts,
  getGasProjects,
  getMastersBundle,
  getJournalStats,
  searchJournalRows,
  saveMfMasters,
  getMfMasters,
} from "./db/master-repo";

// ===========================================
// 監査・下書き・冪等性（audit-repo.ts）
// ===========================================
export type {
  CorrectionRecord,
} from "./db/audit-repo";

export {
  savePurchaseDraft,
  loadPurchaseDraft,
  clearPurchaseDraft,
  getAccountCorrections,
  writeAuditLog,
  getAuditLog,
  checkSlackEventProcessed,
} from "./db/audit-repo";
