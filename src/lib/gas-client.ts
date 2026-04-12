/**
 * gas-client.ts — DB移行済み
 *
 * 元のGAS Web App接続は廃止。すべての呼び出しをdb-client.ts経由でSupabase Postgresへ。
 * 既存の呼び出し元コードを変更せずにDB移行を完了させるため、
 * このファイルはdb-clientからの全面re-exportを行う。
 *
 * 最終的にはこのファイルを削除し、import文を`@/lib/db-client`に置き換える予定。
 *
 * 元のGAS接続実装は `gas-client.ts.backup` に保存。
 */

export {
  // 型
  type DbResponse as GasResponse,
  type RegisterResult,
  type UpdateResult,
  type PurchaseStatus,
  type Employee,
  type DuplicateResult,
  type PastRequest,
  type PendingVoucher,
  type PredictedTxOutput as PredictedTransaction,
  type EmployeeCard,
  type GasCounterparty,
  type GasDepartment,
  type GasAccount,
  type GasTax,
  type GasSubAccount,
  type GasProject,
  type MastersBundle,
  type JournalStats,
  type JournalRow,
  type JournalRowsResult,
  type CounterpartyAccountStat,
  type DeptAccountTaxStat,
  type RemarkAccountStat,
  type MfMastersCache,
  // 関数
  registerPurchase,
  getStatus,
  updateStatus,
  getEmployees,
  updateApprover,
  checkDuplicate,
  getRecentRequests,
  invalidateRecentRequests,
  getPendingVouchers,
  getSuppliers,
  testConnection,
  getPredictedTransactions,
  createPrediction,
  updatePredictionStatus,
  getEmployeeCards,
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
  savePurchaseDraft,
  loadPurchaseDraft,
  clearPurchaseDraft,
} from "./db-client";
