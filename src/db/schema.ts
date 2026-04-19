/**
 * Drizzle ORM スキーマ定義
 *
 * 既存GASスプレッドシートをリレーショナル化したPostgreSQLスキーマ。
 * 原則:
 * - snake_case列名（Drizzleの標準）
 * - 全timestampはwith timezone
 * - enum値はvarcharのCHECKで制約（Drizzleのenumも可能だが変更が辛い）
 * - 金額は円単位のinteger（税込）
 */

import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  boolean,
  varchar,
  date,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  pgEnum,
  numeric,
} from "drizzle-orm/pg-core";

// ========================================================================
// ENUMS（Postgres enum型で定義。将来拡張時はALTER TYPE ADD VALUE）
// ========================================================================

export const purchaseStatusEnum = pgEnum("purchase_status", [
  "申請済",
  "承認済",
  "発注済",
  "検収済",
  "証憑完了",
  "計上済",
  "支払済",
  "差戻し",
  "取消",
]);

export const requestTypeEnum = pgEnum("request_type", ["購入前", "購入済", "役務"]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "会社カード",
  "請求書払い",
  "立替",
]);

export const voucherStatusEnum = pgEnum("voucher_status", [
  "none",
  "uploaded",
  "verified",
  "mf_auto",
]);

export const predictionStatusEnum = pgEnum("prediction_status", [
  "pending",
  "matched",
  "unmatched",
  "cancelled",
]);

export const predictionTypeEnum = pgEnum("prediction_type", [
  "purchase",
  "trip_transport",
  "trip_hotel",
  "trip_daily",
  "reimbursement",
]);

export const invoiceKindEnum = pgEnum("invoice_kind", [
  "適格",
  "非適格",
  "番号なし",
]);

export const invoiceVerificationEnum = pgEnum("invoice_verification", [
  "verified",
  "not_found",
  "no_number",
  "error",
]);

// ========================================================================
// 従業員マスタ（employees）
// ========================================================================

export const employees = pgTable(
  "employees",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    slackId: varchar("slack_id", { length: 30 }).notNull().unique(),
    slackAliases: text("slack_aliases"), // カンマ区切り
    email: varchar("email", { length: 255 }),
    departmentCode: varchar("department_code", { length: 20 }).notNull(),
    departmentName: varchar("department_name", { length: 100 }).notNull(),
    deptHeadSlackId: varchar("dept_head_slack_id", { length: 30 }),
    // カード情報（1人1枚のバーチャルカード想定）
    cardLast4: varchar("card_last4", { length: 4 }),
    cardHolderName: varchar("card_holder_name", { length: 100 }),
    // MF経費との紐付け（office_member_id）
    mfOfficeMemberId: varchar("mf_office_member_id", { length: 50 }),
    // MF給与との紐付け（6桁社員コード 000001 形式）
    payrollCode: varchar("payroll_code", { length: 10 }),
    // 雇用区分: 正社員/アルバイト/役員/契約社員
    employmentType: varchar("employment_type", { length: 20 }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("employees_slack_id_idx").on(t.slackId),
    index("employees_email_idx").on(t.email),
    index("employees_card_last4_idx").on(t.cardLast4),
    index("employees_mf_office_member_idx").on(t.mfOfficeMemberId),
  ],
);

// ========================================================================
// 購買申請（purchase_requests）— メインテーブル
// ========================================================================

export const purchaseRequests = pgTable(
  "purchase_requests",
  {
    poNumber: varchar("po_number", { length: 30 }).primaryKey(), // PO-YYYYMM-NNNN
    status: purchaseStatusEnum("status").notNull().default("申請済"),
    requestType: requestTypeEnum("request_type").notNull(),

    // 申請者情報
    applicantSlackId: varchar("applicant_slack_id", { length: 30 }).notNull(),
    applicantName: varchar("applicant_name", { length: 100 }).notNull(),
    department: varchar("department", { length: 100 }).notNull(),

    // 承認者情報
    approverSlackId: varchar("approver_slack_id", { length: 30 }),
    approverName: varchar("approver_name", { length: 100 }),
    inspectorSlackId: varchar("inspector_slack_id", { length: 30 }),
    inspectorName: varchar("inspector_name", { length: 100 }),

    // 品目情報
    itemName: varchar("item_name", { length: 500 }).notNull(),
    unitPrice: integer("unit_price").notNull(),
    quantity: integer("quantity").notNull().default(1),
    totalAmount: integer("total_amount").notNull(), // 税込

    // 支払情報
    paymentMethod: paymentMethodEnum("payment_method").notNull(),
    purpose: text("purpose"),

    // 購入先
    supplierName: varchar("supplier_name", { length: 200 }),
    supplierUrl: text("supplier_url"),

    // 関連情報
    hubspotDealId: varchar("hubspot_deal_id", { length: 50 }),
    budgetNumber: varchar("budget_number", { length: 50 }),
    katanaPoNumber: varchar("katana_po_number", { length: 50 }),

    // 勘定科目（MF連携用）
    accountTitle: varchar("account_title", { length: 100 }),
    mfAccountCode: varchar("mf_account_code", { length: 20 }),
    mfTaxCode: varchar("mf_tax_code", { length: 20 }),
    mfDepartmentCode: varchar("mf_department_code", { length: 20 }),
    mfProjectCode: varchar("mf_project_code", { length: 20 }),
    mfCounterpartyCode: varchar("mf_counterparty_code", { length: 20 }),
    mfSubAccountCode: varchar("mf_sub_account_code", { length: 20 }),
    mfRemark: text("mf_remark"),

    // 証憑関連
    voucherStatus: voucherStatusEnum("voucher_status").notNull().default("none"),
    voucherAmount: integer("voucher_amount"),
    voucherFileUrl: text("voucher_file_url"),
    voucherUploadedAt: timestamp("voucher_uploaded_at", { withTimezone: true }),
    deliveryNoteFileUrl: text("delivery_note_file_url"),

    // 適格請求書
    registrationNumber: varchar("registration_number", { length: 20 }),
    isQualifiedInvoice: invoiceKindEnum("is_qualified_invoice"),
    invoiceVerificationStatus: invoiceVerificationEnum("invoice_verification_status"),

    // Slack連携
    slackChannelId: varchar("slack_channel_id", { length: 30 }),
    slackMessageTs: varchar("slack_message_ts", { length: 50 }),
    slackThreadTs: varchar("slack_thread_ts", { length: 50 }),

    // MF会計Plus連携
    stage1JournalId: integer("stage1_journal_id"),
    matchedJournalId: integer("matched_journal_id"),

    // ステータス変遷タイムスタンプ
    applicationDate: timestamp("application_date", { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    orderedAt: timestamp("ordered_at", { withTimezone: true }),
    inspectedAt: timestamp("inspected_at", { withTimezone: true }),
    voucherCompletedAt: timestamp("voucher_completed_at", { withTimezone: true }),
    purchaseDate: date("purchase_date"),

    // 検収関連
    inspectedQuantity: integer("inspected_quantity"),

    // 備考
    remarks: text("remarks"),

    // 出張日当（給与連携用）: TRIP-プレフィックスの場合のみ値あり
    // 日帰り=1000円、泊まり=3000円×(泊数+1)
    tripAllowance: integer("trip_allowance"),

    // フラグ
    isEstimate: boolean("is_estimate").notNull().default(false),
    isPostReport: boolean("is_post_report").notNull().default(false),

    // 監査
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("purchase_requests_status_idx").on(t.status),
    index("purchase_requests_applicant_idx").on(t.applicantSlackId),
    index("purchase_requests_approver_idx").on(t.approverSlackId),
    index("purchase_requests_application_date_idx").on(t.applicationDate),
    index("purchase_requests_slack_ts_idx").on(t.slackMessageTs),
  ],
);

// ========================================================================
// 予測カード明細（predicted_transactions）— カード照合用
// ========================================================================

export const predictedTransactions = pgTable(
  "predicted_transactions",
  {
    id: varchar("id", { length: 30 }).primaryKey(), // PCT-YYYYMM-NNNN
    poNumber: varchar("po_number", { length: 30 }), // FK → purchase_requests.po_number（出張の場合はnull可）
    type: predictionTypeEnum("type").notNull(),
    cardLast4: varchar("card_last4", { length: 4 }),
    mfOfficeMemberId: varchar("mf_office_member_id", { length: 50 }), // 従業員紐付けの主キー
    predictedAmount: integer("predicted_amount").notNull(),
    predictedDate: date("predicted_date").notNull(),
    supplier: varchar("supplier", { length: 200 }),
    applicant: varchar("applicant", { length: 100 }),
    applicantSlackId: varchar("applicant_slack_id", { length: 30 }),

    // 照合結果
    status: predictionStatusEnum("status").notNull().default("pending"),
    matchedJournalId: integer("matched_journal_id"),
    matchedAt: timestamp("matched_at", { withTimezone: true }),
    amountDiff: integer("amount_diff"),

    // MF経費側ID（ex_transaction.id）
    mfExTransactionId: varchar("mf_ex_transaction_id", { length: 50 }),

    // フラグ
    isEstimate: boolean("is_estimate").notNull().default(false),
    isPostReport: boolean("is_post_report").notNull().default(false),
    emergencyReason: text("emergency_reason"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("predicted_transactions_status_idx").on(t.status),
    index("predicted_transactions_po_number_idx").on(t.poNumber),
    index("predicted_transactions_card_last4_idx").on(t.cardLast4),
    index("predicted_transactions_office_member_idx").on(t.mfOfficeMemberId),
    index("predicted_transactions_predicted_date_idx").on(t.predictedDate),
  ],
);

// ========================================================================
// MFマスタ（counterparties, departments, accounts, taxes, sub_accounts, projects）
// ========================================================================

export const mfCounterparties = pgTable(
  "mf_counterparties",
  {
    mfId: varchar("mf_id", { length: 30 }).primaryKey(),
    code: varchar("code", { length: 20 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    searchKey: varchar("search_key", { length: 200 }),
    invoiceRegistrationNumber: varchar("invoice_registration_number", { length: 20 }),
    alias: text("alias"),
    available: boolean("available").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("mf_counterparties_code_idx").on(t.code),
    index("mf_counterparties_name_idx").on(t.name),
  ],
);

export const mfDepartments = pgTable(
  "mf_departments",
  {
    mfId: varchar("mf_id", { length: 30 }).primaryKey(),
    code: varchar("code", { length: 20 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    searchKey: varchar("search_key", { length: 200 }),
    available: boolean("available").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mf_departments_code_idx").on(t.code)],
);

export const mfAccounts = pgTable(
  "mf_accounts",
  {
    mfId: varchar("mf_id", { length: 30 }).primaryKey(),
    code: varchar("code", { length: 20 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    searchKey: varchar("search_key", { length: 200 }),
    taxId: integer("tax_id"),
    available: boolean("available").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mf_accounts_code_idx").on(t.code)],
);

export const mfTaxes = pgTable(
  "mf_taxes",
  {
    mfId: varchar("mf_id", { length: 30 }).primaryKey(),
    code: varchar("code", { length: 20 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    abbreviation: varchar("abbreviation", { length: 50 }),
    taxRate: integer("tax_rate"), // パーセント×100 (10.0% → 1000) で整数保存
    available: boolean("available").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mf_taxes_code_idx").on(t.code)],
);

export const mfSubAccounts = pgTable(
  "mf_sub_accounts",
  {
    mfId: varchar("mf_id", { length: 30 }).primaryKey(),
    code: varchar("code", { length: 20 }).notNull(),
    accountId: integer("account_id"),
    name: varchar("name", { length: 200 }).notNull(),
    searchKey: varchar("search_key", { length: 200 }),
    available: boolean("available").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("mf_sub_accounts_code_idx").on(t.code),
    index("mf_sub_accounts_account_id_idx").on(t.accountId),
  ],
);

export const mfProjects = pgTable(
  "mf_projects",
  {
    mfId: varchar("mf_id", { length: 30 }).primaryKey(),
    code: varchar("code", { length: 20 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    searchKey: varchar("search_key", { length: 200 }),
    available: boolean("available").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mf_projects_code_idx").on(t.code)],
);

// ========================================================================
// MFマスタJSONキャッシュ（mf_masters_cache）— MF APIマスタの全量保存
// ========================================================================

export const mfMastersCache = pgTable("mf_masters_cache", {
  id: varchar("id", { length: 50 }).primaryKey(), // "mf_masters"固定
  accounts: jsonb("accounts"),
  taxes: jsonb("taxes"),
  subAccounts: jsonb("sub_accounts"),
  projects: jsonb("projects"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

// ========================================================================
// 下書き（purchase_drafts）
// ========================================================================

export const purchaseDrafts = pgTable(
  "purchase_drafts",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id", { length: 30 }).notNull(),
    draft: jsonb("draft").notNull(),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("purchase_drafts_user_id_idx").on(t.userId)],
);

// ========================================================================
// 仕訳統計キャッシュ（journal_stats）— RAG用の統計データ
// ========================================================================

export const journalStats = pgTable("journal_stats", {
  id: varchar("id", { length: 50 }).primaryKey(), // "journal_stats"固定
  counterpartyAccounts: jsonb("counterparty_accounts"), // [{counterparty, account, taxType, count}]
  deptAccountTax: jsonb("dept_account_tax"),
  remarkAccounts: jsonb("remark_accounts"),
  totalJournals: integer("total_journals"),
  totalRows: integer("total_rows"),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

// ========================================================================
// 過去仕訳（journal_rows）— RAG検索用の生データ
// ========================================================================

export const journalRows = pgTable(
  "journal_rows",
  {
    id: serial("id").primaryKey(),
    date: date("date").notNull(),
    remark: text("remark"),
    account: varchar("account", { length: 100 }),
    taxType: varchar("tax_type", { length: 50 }),
    amount: integer("amount"),
    department: varchar("department", { length: 100 }),
    counterparty: varchar("counterparty", { length: 200 }),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("journal_rows_counterparty_idx").on(t.counterparty),
    index("journal_rows_department_idx").on(t.department),
    index("journal_rows_date_idx").on(t.date),
  ],
);

// ========================================================================
// MF OAuthトークン（mf_oauth_tokens）
// ========================================================================

export const mfOauthTokens = pgTable("mf_oauth_tokens", {
  id: varchar("id", { length: 50 }).primaryKey(), // "mf_accounting"等のscope識別子
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  tokenType: varchar("token_type", { length: 30 }).notNull().default("Bearer"),
  scope: text("scope"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ========================================================================
// Slackイベント冪等性（slack_event_log）
// ========================================================================

export const slackEventLog = pgTable(
  "slack_event_log",
  {
    eventId: varchar("event_id", { length: 100 }).primaryKey(),
    eventType: varchar("event_type", { length: 50 }),
    payload: jsonb("payload"),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("slack_event_log_processed_at_idx").on(t.processedAt)],
);

// ========================================================================
// 監査ログ（audit_log）— 変更履歴の追跡
// ========================================================================

export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    tableName: varchar("table_name", { length: 50 }).notNull(),
    recordId: varchar("record_id", { length: 50 }).notNull(), // PO番号等
    action: varchar("action", { length: 20 }).notNull(), // created, updated, deleted
    changedBy: varchar("changed_by", { length: 100 }), // Slack ID or name
    fieldName: varchar("field_name", { length: 100 }), // 変更フィールド名
    oldValue: text("old_value"),
    newValue: text("new_value"),
    metadata: jsonb("metadata"), // 追加コンテキスト
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_table_record_idx").on(t.tableName, t.recordId),
    index("audit_log_created_at_idx").on(t.createdAt),
    index("audit_log_changed_by_idx").on(t.changedBy),
  ],
);

export type AuditLogEntry = typeof auditLog.$inferSelect;

// ========================================================================
// Dead Letter Queue（DLQ）— 失敗タスクの記録
// ========================================================================

export const deadLetterQueue = pgTable(
  "dead_letter_queue",
  {
    id: serial("id").primaryKey(),
    taskId: varchar("task_id", { length: 100 }).notNull(),
    taskType: varchar("task_type", { length: 50 }).notNull(),
    errorMessage: text("error_message").notNull(),
    retryCount: integer("retry_count").notNull(),
    payload: jsonb("payload"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("dlq_task_type_idx").on(t.taskType),
    index("dlq_created_at_idx").on(t.createdAt),
  ],
);

// ========================================================================
// 型エクスポート
// ========================================================================

export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;

export type PurchaseRequest = typeof purchaseRequests.$inferSelect;
export type NewPurchaseRequest = typeof purchaseRequests.$inferInsert;

export type PredictedTransaction = typeof predictedTransactions.$inferSelect;
export type NewPredictedTransaction = typeof predictedTransactions.$inferInsert;

export type MfCounterparty = typeof mfCounterparties.$inferSelect;
export type MfDepartment = typeof mfDepartments.$inferSelect;
export type MfAccount = typeof mfAccounts.$inferSelect;
export type MfTax = typeof mfTaxes.$inferSelect;
export type MfSubAccount = typeof mfSubAccounts.$inferSelect;
export type MfProject = typeof mfProjects.$inferSelect;

// ========================================================================
// 勘定科目修正履歴（account_corrections）— 仕訳推定の学習ループ用
// ========================================================================

export const accountCorrections = pgTable(
  "account_corrections",
  {
    id: serial("id").primaryKey(),

    // 対象
    poNumber: varchar("po_number", { length: 30 }).notNull(),
    itemName: varchar("item_name", { length: 500 }).notNull(),
    supplierName: varchar("supplier_name", { length: 200 }),
    department: varchar("department", { length: 100 }),
    totalAmount: integer("total_amount"),

    // 修正前（AI推定値）
    estimatedAccount: varchar("estimated_account", { length: 100 }).notNull(),
    estimatedTaxType: varchar("estimated_tax_type", { length: 50 }),
    estimatedConfidence: varchar("estimated_confidence", { length: 10 }),

    // 修正後（ユーザー確定値）
    correctedAccount: varchar("corrected_account", { length: 100 }).notNull(),
    correctedTaxType: varchar("corrected_tax_type", { length: 50 }),

    // メタ
    correctedBy: varchar("corrected_by", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("account_corrections_supplier_idx").on(t.supplierName),
    index("account_corrections_item_idx").on(t.itemName),
    index("account_corrections_created_at_idx").on(t.createdAt),
  ],
);

export type AccountCorrection = typeof accountCorrections.$inferSelect;

// ========================================================================
// 継続契約マスタ（contracts）— 役務提供・SaaS・派遣等の管理
// ========================================================================

export const contractCategoryEnum = pgEnum("contract_category", [
  "派遣",
  "外注",
  "SaaS",
  "顧問",
  "賃貸",
  "保守",
  "清掃",
  "その他",
]);

export const billingTypeEnum = pgEnum("billing_type", [
  "固定",
  "従量",
  "カード自動",
]);

export const contractInvoiceStatusEnum = pgEnum("contract_invoice_status", [
  "未受領",
  "受領済",
  "承認済",
  "仕訳済",
  "見積計上",
]);

export const contracts = pgTable(
  "contracts",
  {
    id: serial("id").primaryKey(),
    contractNumber: varchar("contract_number", { length: 30 }).notNull().unique(),

    // 分類
    category: contractCategoryEnum("category").notNull(),
    billingType: billingTypeEnum("billing_type").notNull(),

    // 取引先
    supplierName: varchar("supplier_name", { length: 200 }).notNull(),
    supplierContact: varchar("supplier_contact", { length: 200 }),

    // 金額
    monthlyAmount: integer("monthly_amount"),
    annualAmount: integer("annual_amount"),
    budgetAmount: integer("budget_amount"),

    // 契約期間
    contractStartDate: date("contract_start_date").notNull(),
    contractEndDate: date("contract_end_date"),
    renewalType: varchar("renewal_type", { length: 20 }).notNull().default("自動更新"),
    renewalAlertDays: integer("renewal_alert_days").notNull().default(60),

    // 会計
    accountTitle: varchar("account_title", { length: 100 }).notNull(),
    mfAccountCode: varchar("mf_account_code", { length: 20 }),
    mfTaxCode: varchar("mf_tax_code", { length: 20 }),
    mfDepartmentCode: varchar("mf_department_code", { length: 20 }),
    mfCounterpartyCode: varchar("mf_counterparty_code", { length: 20 }),

    // 管理
    department: varchar("department", { length: 100 }).notNull(),
    requesterSlackId: varchar("requester_slack_id", { length: 30 }),
    approverSlackId: varchar("approver_slack_id", { length: 30 }),

    // 自動化
    autoApprove: boolean("auto_approve").notNull().default(false),
    autoAccrue: boolean("auto_accrue").notNull().default(true),

    // ステータス
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),

    // 契約書保管（Notion permalink）
    contractFileUrl: text("contract_file_url"),
    contractFileName: varchar("contract_file_name", { length: 255 }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contracts_active_idx").on(t.isActive),
    index("contracts_end_date_idx").on(t.contractEndDate),
    index("contracts_category_idx").on(t.category),
    index("contracts_supplier_idx").on(t.supplierName),
  ],
);

export type Contract = typeof contracts.$inferSelect;
export type NewContract = typeof contracts.$inferInsert;

// ========================================================================
// 月次請求書レコード（contract_invoices）
// ========================================================================

export const contractInvoices = pgTable(
  "contract_invoices",
  {
    id: serial("id").primaryKey(),
    contractId: integer("contract_id").notNull(),

    // 請求
    billingMonth: varchar("billing_month", { length: 7 }).notNull(),
    invoiceAmount: integer("invoice_amount"),
    expectedAmount: integer("expected_amount"),
    amountDiff: integer("amount_diff"),

    // ステータス
    status: contractInvoiceStatusEnum("status").notNull().default("未受領"),

    // 承認
    approvedBy: varchar("approved_by", { length: 100 }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),

    // 証憑
    voucherFileUrl: text("voucher_file_url"),
    voucherUploadedAt: timestamp("voucher_uploaded_at", { withTimezone: true }),

    // 従量系（billing_type="従量" の場合に使用）
    hours: numeric("hours", { precision: 8, scale: 2 }),
    units: numeric("units", { precision: 10, scale: 2 }),
    reportNotes: text("report_notes"),

    // 仕訳
    journalId: integer("journal_id"),
    accrualJournalId: integer("accrual_journal_id"),
    reversalJournalId: integer("reversal_journal_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contract_invoices_contract_idx").on(t.contractId),
    index("contract_invoices_month_idx").on(t.billingMonth),
    index("contract_invoices_status_idx").on(t.status),
    // 二重計上防止: 同一契約×同一月は1行のみ
    uniqueIndex("contract_invoices_contract_month_unique").on(t.contractId, t.billingMonth),
  ],
);

export type ContractInvoice = typeof contractInvoices.$inferSelect;
export type NewContractInvoice = typeof contractInvoices.$inferInsert;
