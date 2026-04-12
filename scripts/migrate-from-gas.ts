/**
 * GASスプレッドシート → Supabase Postgres データ移行スクリプト
 *
 * 移行対象:
 * 1. 従業員マスタ (employees)
 * 2. MFマスタ (counterparties, departments, accounts, taxes, sub_accounts, projects)
 * 3. MFマスタJSONキャッシュ (mf_masters_cache)
 * 4. 仕訳統計 (journal_stats) — 存在すれば
 * 5. 過去申請 (purchase_requests) — 最も大きなデータ
 * 6. 予測テーブル (predicted_transactions) — 存在すれば
 *
 * 安全性:
 * - 既存DBテーブルの中身はクリアしない（ON CONFLICTで上書き or スキップ）
 * - GAS側はREAD専用（書き込み一切なし）
 * - 冪等性: 何度実行しても同じ結果
 *
 * 使い方:
 *   npx tsx scripts/migrate-from-gas.ts [--dry-run]
 */

import { config } from "dotenv";
// 複数ファイルから読み込み（productionの環境変数を優先）
config({ path: ".env.production" });
config({ path: ".env.development.local" });

// 環境変数設定前にgas-clientをimportすると constant キャプチャに失敗するので
// dynamic importを使う（後述）
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

// gas-client を動的に読み込む（process.env 設定後）
let gasClient: typeof import("../src/lib/gas-client");
async function loadGasClient() {
  if (!gasClient) {
    gasClient = await import("../src/lib/gas-client");
  }
  return gasClient;
}

const DRY_RUN = process.argv.includes("--dry-run");

// 直接接続（PgBouncer非経由でトランザクション使用）
const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!connectionString) {
  console.error("POSTGRES_URL_NON_POOLING or POSTGRES_URL is required");
  process.exit(1);
}
const client = postgres(connectionString, { max: 1, prepare: false });
const db = drizzle(client, { schema });

// ============================================================
// カウンタ管理
// ============================================================

interface MigrationStats {
  employees: { total: number; inserted: number; updated: number; skipped: number };
  counterparties: { total: number; inserted: number; updated: number; skipped: number };
  departments: { total: number; inserted: number; updated: number; skipped: number };
  accounts: { total: number; inserted: number; updated: number; skipped: number };
  taxes: { total: number; inserted: number; updated: number; skipped: number };
  subAccounts: { total: number; inserted: number; updated: number; skipped: number };
  projects: { total: number; inserted: number; updated: number; skipped: number };
  mfMastersCache: { saved: boolean };
  journalStats: { saved: boolean };
  purchaseRequests: { total: number; inserted: number; updated: number; skipped: number };
  predictions: { total: number; inserted: number; updated: number; skipped: number };
}

const stats: MigrationStats = {
  employees: { total: 0, inserted: 0, updated: 0, skipped: 0 },
  counterparties: { total: 0, inserted: 0, updated: 0, skipped: 0 },
  departments: { total: 0, inserted: 0, updated: 0, skipped: 0 },
  accounts: { total: 0, inserted: 0, updated: 0, skipped: 0 },
  taxes: { total: 0, inserted: 0, updated: 0, skipped: 0 },
  subAccounts: { total: 0, inserted: 0, updated: 0, skipped: 0 },
  projects: { total: 0, inserted: 0, updated: 0, skipped: 0 },
  mfMastersCache: { saved: false },
  journalStats: { saved: false },
  purchaseRequests: { total: 0, inserted: 0, updated: 0, skipped: 0 },
  predictions: { total: 0, inserted: 0, updated: 0, skipped: 0 },
};

// ============================================================
// 移行ロジック
// ============================================================

async function migrateEmployees() {
  console.log("\n▶ 従業員マスタ移行中...");
  const gas = await loadGasClient();
  const result = await gas.getEmployees();
  if (!result.success || !result.data) {
    console.warn("  [skip] 従業員マスタ取得失敗:", result.error);
    return;
  }
  const list = result.data.employees;
  stats.employees.total = list.length;

  if (DRY_RUN) {
    console.log(`  [dry-run] ${list.length} 件の従業員を移行予定`);
    return;
  }

  for (const emp of list) {
    const existing = await db
      .select()
      .from(schema.employees)
      .where(eq(schema.employees.slackId, emp.slackId))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(schema.employees)
        .set({
          name: emp.name,
          slackAliases: emp.slackAliases,
          departmentCode: emp.departmentCode,
          departmentName: emp.departmentName,
          deptHeadSlackId: emp.deptHeadSlackId || null,
          updatedAt: new Date(),
        })
        .where(eq(schema.employees.slackId, emp.slackId));
      stats.employees.updated++;
    } else {
      await db.insert(schema.employees).values({
        name: emp.name,
        slackId: emp.slackId,
        slackAliases: emp.slackAliases,
        departmentCode: emp.departmentCode,
        departmentName: emp.departmentName,
        deptHeadSlackId: emp.deptHeadSlackId || null,
      });
      stats.employees.inserted++;
    }
  }
  console.log(`  ✓ ${stats.employees.inserted} 新規, ${stats.employees.updated} 更新`);
}

async function migrateMasters() {
  console.log("\n▶ MFマスタ移行中...");
  const gas = await loadGasClient();

  // 1. 取引先
  const cp = await gas.getGasCounterparties();
  if (cp.success && cp.data) {
    stats.counterparties.total = cp.data.counterparties.length;
    if (!DRY_RUN) {
      for (const c of cp.data.counterparties) {
        await db
          .insert(schema.mfCounterparties)
          .values({
            mfId: c.mfId,
            code: c.code,
            name: c.name,
            searchKey: c.searchKey || null,
            invoiceRegistrationNumber: c.invoiceRegistrationNumber || null,
            alias: c.alias || null,
            available: c.available,
          })
          .onConflictDoUpdate({
            target: schema.mfCounterparties.mfId,
            set: {
              code: c.code,
              name: c.name,
              searchKey: c.searchKey || null,
              invoiceRegistrationNumber: c.invoiceRegistrationNumber || null,
              alias: c.alias || null,
              available: c.available,
              updatedAt: new Date(),
            },
          });
        stats.counterparties.inserted++;
      }
    }
    console.log(`  ✓ 取引先: ${stats.counterparties.total}件`);
  }

  // 2. 部門
  const dept = await gas.getGasDepartments();
  if (dept.success && dept.data) {
    stats.departments.total = dept.data.departments.length;
    if (!DRY_RUN) {
      for (const d of dept.data.departments) {
        await db
          .insert(schema.mfDepartments)
          .values({
            mfId: d.mfId,
            code: d.code,
            name: d.name,
            searchKey: d.searchKey || null,
            available: d.available,
          })
          .onConflictDoUpdate({
            target: schema.mfDepartments.mfId,
            set: {
              code: d.code,
              name: d.name,
              searchKey: d.searchKey || null,
              available: d.available,
              updatedAt: new Date(),
            },
          });
        stats.departments.inserted++;
      }
    }
    console.log(`  ✓ 部門: ${stats.departments.total}件`);
  }

  // 3. 勘定科目
  const acc = await gas.getGasAccounts();
  if (acc.success && acc.data) {
    stats.accounts.total = acc.data.accounts.length;
    if (!DRY_RUN) {
      for (const a of acc.data.accounts) {
        await db
          .insert(schema.mfAccounts)
          .values({
            mfId: a.mfId,
            code: a.code,
            name: a.name,
            searchKey: a.searchKey || null,
            taxId: a.taxId ?? null,
            available: a.available,
          })
          .onConflictDoUpdate({
            target: schema.mfAccounts.mfId,
            set: {
              code: a.code,
              name: a.name,
              searchKey: a.searchKey || null,
              taxId: a.taxId ?? null,
              available: a.available,
              updatedAt: new Date(),
            },
          });
        stats.accounts.inserted++;
      }
    }
    console.log(`  ✓ 勘定科目: ${stats.accounts.total}件`);
  }

  // 4. 税区分
  const tx = await gas.getGasTaxes();
  if (tx.success && tx.data) {
    stats.taxes.total = tx.data.taxes.length;
    if (!DRY_RUN) {
      for (const t of tx.data.taxes) {
        await db
          .insert(schema.mfTaxes)
          .values({
            mfId: t.mfId,
            code: t.code,
            name: t.name,
            abbreviation: t.abbreviation || null,
            taxRate: t.taxRate !== null ? Math.round(t.taxRate * 100) : null,
            available: t.available,
          })
          .onConflictDoUpdate({
            target: schema.mfTaxes.mfId,
            set: {
              code: t.code,
              name: t.name,
              abbreviation: t.abbreviation || null,
              taxRate: t.taxRate !== null ? Math.round(t.taxRate * 100) : null,
              available: t.available,
              updatedAt: new Date(),
            },
          });
        stats.taxes.inserted++;
      }
    }
    console.log(`  ✓ 税区分: ${stats.taxes.total}件`);
  }

  // 5. 補助科目
  const sub = await gas.getGasSubAccounts();
  if (sub.success && sub.data) {
    stats.subAccounts.total = sub.data.subAccounts.length;
    if (!DRY_RUN) {
      for (const s of sub.data.subAccounts) {
        await db
          .insert(schema.mfSubAccounts)
          .values({
            mfId: s.mfId,
            code: s.code,
            accountId: s.accountId ?? null,
            name: s.name,
            searchKey: s.searchKey || null,
            available: s.available,
          })
          .onConflictDoUpdate({
            target: schema.mfSubAccounts.mfId,
            set: {
              code: s.code,
              accountId: s.accountId ?? null,
              name: s.name,
              searchKey: s.searchKey || null,
              available: s.available,
              updatedAt: new Date(),
            },
          });
        stats.subAccounts.inserted++;
      }
    }
    console.log(`  ✓ 補助科目: ${stats.subAccounts.total}件`);
  }

  // 6. PJ
  const pj = await gas.getGasProjects();
  if (pj.success && pj.data) {
    stats.projects.total = pj.data.projects.length;
    if (!DRY_RUN) {
      for (const p of pj.data.projects) {
        await db
          .insert(schema.mfProjects)
          .values({
            mfId: p.mfId,
            code: p.code,
            name: p.name,
            searchKey: p.searchKey || null,
            available: p.available,
          })
          .onConflictDoUpdate({
            target: schema.mfProjects.mfId,
            set: {
              code: p.code,
              name: p.name,
              searchKey: p.searchKey || null,
              available: p.available,
              updatedAt: new Date(),
            },
          });
        stats.projects.inserted++;
      }
    }
    console.log(`  ✓ PJ: ${stats.projects.total}件`);
  }
}

async function migrateMfMastersCache() {
  console.log("\n▶ MFマスタJSONキャッシュ移行中...");
  const gas = await loadGasClient();
  const result = await gas.getMfMasters();
  if (!result.success || !result.data?.masters) {
    console.warn("  [skip] MFマスタキャッシュ取得失敗");
    return;
  }
  const m = result.data.masters;

  if (DRY_RUN) {
    console.log(`  [dry-run] accounts=${m.accounts.length}, taxes=${m.taxes.length}`);
    return;
  }

  await db
    .insert(schema.mfMastersCache)
    .values({
      id: "mf_masters",
      accounts: m.accounts,
      taxes: m.taxes,
      subAccounts: m.subAccounts,
      projects: m.projects,
      syncedAt: new Date(m.syncedAt),
    })
    .onConflictDoUpdate({
      target: schema.mfMastersCache.id,
      set: {
        accounts: m.accounts,
        taxes: m.taxes,
        subAccounts: m.subAccounts,
        projects: m.projects,
        syncedAt: new Date(m.syncedAt),
      },
    });
  stats.mfMastersCache.saved = true;
  console.log(`  ✓ accounts=${m.accounts.length}, taxes=${m.taxes.length}, subAccounts=${m.subAccounts.length}, projects=${m.projects.length}`);
}

async function migrateJournalStats() {
  console.log("\n▶ 仕訳統計移行中...");
  const gas = await loadGasClient();
  const s = await gas.getJournalStats();
  if (!s) {
    console.warn("  [skip] 仕訳統計取得失敗");
    return;
  }

  if (DRY_RUN) {
    console.log(`  [dry-run] totalJournals=${s.totalJournals}, totalRows=${s.totalRows}`);
    return;
  }

  await db
    .insert(schema.journalStats)
    .values({
      id: "journal_stats",
      counterpartyAccounts: s.counterpartyAccounts,
      deptAccountTax: s.deptAccountTax,
      remarkAccounts: s.remarkAccounts,
      totalJournals: s.totalJournals,
      totalRows: s.totalRows,
      computedAt: new Date(s.computedAt),
    })
    .onConflictDoUpdate({
      target: schema.journalStats.id,
      set: {
        counterpartyAccounts: s.counterpartyAccounts,
        deptAccountTax: s.deptAccountTax,
        remarkAccounts: s.remarkAccounts,
        totalJournals: s.totalJournals,
        totalRows: s.totalRows,
        computedAt: new Date(s.computedAt),
      },
    });
  stats.journalStats.saved = true;
  console.log(`  ✓ totalJournals=${s.totalJournals}, totalRows=${s.totalRows}`);
}

/** 日付パーサー: GASからの文字列を安全にDate化 */
function parseDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function mapPaymentMethod(v: string | undefined): "会社カード" | "請求書払い" | "立替" {
  if (!v) return "会社カード";
  if (v.includes("カード")) return "会社カード";
  if (v.includes("請求書")) return "請求書払い";
  if (v.includes("立替")) return "立替";
  return "会社カード";
}

function mapStatus(past: {
  approvalStatus?: string;
  orderStatus?: string;
  inspectionStatus?: string;
  voucherStatus?: string;
}): "申請済" | "承認済" | "発注済" | "検収済" | "証憑完了" | "計上済" | "支払済" | "差戻し" | "取消" {
  if (past.approvalStatus === "差戻し") return "差戻し";
  if (past.approvalStatus === "承認待ち" || !past.approvalStatus) return "申請済";
  // 承認以降
  if (past.voucherStatus === "添付済" || past.voucherStatus === "MF自動取得") return "証憑完了";
  if (past.inspectionStatus === "検収済") return "検収済";
  if (past.orderStatus === "発注済") return "発注済";
  return "承認済";
}

function mapVoucherStatus(v: string | undefined): "none" | "uploaded" | "verified" | "mf_auto" {
  if (!v) return "none";
  if (v.includes("MF自動取得")) return "mf_auto";
  if (v.includes("添付済") || v.includes("verified")) return "verified";
  if (v.includes("uploaded")) return "uploaded";
  return "none";
}

async function migratePurchaseRequests() {
  console.log("\n▶ 購買申請移行中...");
  const gas = await loadGasClient();
  // 全件取得（limit=1000）
  const result = await gas.getRecentRequests(undefined, 1000);
  if (!result.success || !result.data) {
    console.warn("  [skip] 購買申請取得失敗:", result.error);
    return;
  }
  const list = result.data.requests;
  stats.purchaseRequests.total = list.length;

  if (DRY_RUN) {
    console.log(`  [dry-run] ${list.length} 件の購買申請を移行予定`);
    return;
  }

  for (const pr of list) {
    if (!pr.prNumber) {
      stats.purchaseRequests.skipped++;
      continue;
    }

    // 申請者のSlackIDを従業員マスタから引く
    const applicantEmp = await db
      .select()
      .from(schema.employees)
      .where(eq(schema.employees.name, pr.applicant))
      .limit(1);
    const applicantSlackId = applicantEmp[0]?.slackId ?? "";

    const values: schema.NewPurchaseRequest = {
      poNumber: pr.prNumber,
      status: mapStatus(pr),
      requestType: pr.type === "購入済" || pr.type === "購入報告" ? "購入済" : "購入前",
      applicantSlackId,
      applicantName: pr.applicant || "",
      department: pr.department || "",
      itemName: pr.itemName || "",
      unitPrice: pr.unitPrice || pr.totalAmount || 0,
      quantity: pr.quantity || 1,
      totalAmount: pr.totalAmount || 0,
      paymentMethod: mapPaymentMethod(pr.paymentMethod),
      purpose: pr.purpose || null,
      supplierName: pr.supplierName || null,
      supplierUrl: pr.supplierUrl || null,
      hubspotDealId: pr.hubspotInfo || null,
      accountTitle: pr.accountTitle || null,
      remarks: pr.remarks || null,
      voucherStatus: mapVoucherStatus(pr.voucherStatus),
      registrationNumber: pr.registrationNumber || null,
      isQualifiedInvoice: (pr.isQualifiedInvoice as "適格" | "非適格" | "番号なし") || null,
      invoiceVerificationStatus: (pr.invoiceVerificationStatus as "verified" | "not_found" | "no_number" | "error") || null,
      applicationDate: parseDate(pr.applicationDate) ?? new Date(),
      inspectedAt: parseDate(pr.inspectionDate),
    };

    const existing = await db
      .select()
      .from(schema.purchaseRequests)
      .where(eq(schema.purchaseRequests.poNumber, pr.prNumber))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(schema.purchaseRequests)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(schema.purchaseRequests.poNumber, pr.prNumber));
      stats.purchaseRequests.updated++;
    } else {
      try {
        await db.insert(schema.purchaseRequests).values(values);
        stats.purchaseRequests.inserted++;
      } catch (e) {
        console.warn(`  [skip] ${pr.prNumber}:`, e instanceof Error ? e.message : String(e));
        stats.purchaseRequests.skipped++;
      }
    }
  }
  console.log(`  ✓ ${stats.purchaseRequests.inserted} 新規, ${stats.purchaseRequests.updated} 更新, ${stats.purchaseRequests.skipped} スキップ`);
}

async function migratePredictions() {
  console.log("\n▶ 予測テーブル移行中...");
  const gas = await loadGasClient();
  // 直近3ヶ月分
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  for (const month of months) {
    const result = await gas.getPredictedTransactions(month);
    if (!result.success || !result.data) continue;

    const list = result.data.predictions;
    stats.predictions.total += list.length;

    if (DRY_RUN) {
      console.log(`  [dry-run] ${month}: ${list.length}件`);
      continue;
    }

    for (const p of list) {
      try {
        await db
          .insert(schema.predictedTransactions)
          .values({
            id: p.id,
            poNumber: p.po_number || null,
            type: (p.type as "purchase" | "trip_transport" | "trip_hotel" | "trip_daily") || "purchase",
            cardLast4: p.card_last4 || null,
            predictedAmount: p.predicted_amount,
            predictedDate: p.predicted_date,
            supplier: p.supplier || null,
            applicant: p.applicant || null,
            status: (p.status as "pending" | "matched" | "unmatched" | "cancelled") || "pending",
            matchedJournalId: p.matched_journal_id ?? null,
            matchedAt: p.matched_at ? new Date(p.matched_at) : null,
            amountDiff: p.amount_diff ?? null,
            isEstimate: p.is_estimate ?? false,
            isPostReport: p.is_post_report ?? false,
            emergencyReason: p.emergency_reason || null,
            createdAt: parseDate(p.created_at) ?? new Date(),
          })
          .onConflictDoUpdate({
            target: schema.predictedTransactions.id,
            set: {
              status: (p.status as "pending" | "matched" | "unmatched" | "cancelled") || "pending",
              matchedJournalId: p.matched_journal_id ?? null,
              matchedAt: p.matched_at ? new Date(p.matched_at) : null,
              amountDiff: p.amount_diff ?? null,
            },
          });
        stats.predictions.inserted++;
      } catch (e) {
        console.warn(`  [skip] ${p.id}:`, e instanceof Error ? e.message : String(e));
        stats.predictions.skipped++;
      }
    }
    console.log(`  ${month}: ${list.length}件`);
  }
  console.log(`  ✓ 合計 ${stats.predictions.inserted} 件移行, ${stats.predictions.skipped} スキップ`);
}

// ============================================================
// メイン
// ============================================================

async function main() {
  console.log("=".repeat(60));
  console.log(DRY_RUN ? "[DRY RUN] GAS → Supabase データ移行" : "GAS → Supabase データ移行");
  console.log("=".repeat(60));

  try {
    await migrateEmployees();
    await migrateMasters();
    await migrateMfMastersCache();
    await migrateJournalStats();
    await migratePurchaseRequests();
    await migratePredictions();

    // 件数検証
    if (!DRY_RUN) {
      console.log("\n▶ DB件数検証...");
      const empCount = await db.select({ count: sql<number>`count(*)` }).from(schema.employees);
      const prCount = await db.select({ count: sql<number>`count(*)` }).from(schema.purchaseRequests);
      const cpCount = await db.select({ count: sql<number>`count(*)` }).from(schema.mfCounterparties);
      const predCount = await db.select({ count: sql<number>`count(*)` }).from(schema.predictedTransactions);
      console.log(`  employees: ${empCount[0].count}`);
      console.log(`  purchase_requests: ${prCount[0].count}`);
      console.log(`  mf_counterparties: ${cpCount[0].count}`);
      console.log(`  predicted_transactions: ${predCount[0].count}`);
    }

    console.log("\n" + "=".repeat(60));
    console.log("移行完了");
    console.log("=".repeat(60));
    console.log(JSON.stringify(stats, null, 2));
  } catch (e) {
    console.error("\n[ERROR]", e);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
