/**
 * MFマスタ・仕訳統計リポジトリ
 */

import { desc, eq, like } from "drizzle-orm";
import { db } from "@/db";
import {
  mfCounterparties,
  mfDepartments,
  mfAccounts,
  mfTaxes,
  mfSubAccounts,
  mfProjects,
  mfMastersCache,
  journalStats,
  journalRows,
} from "@/db/schema";
import { cachedFetch } from "../shared-cache";
import {
  type DbResponse,
  ok,
  ng,
  DB_MASTER_TTL,
  DB_STATS_TTL,
} from "./types";

// ===========================================
// MFマスタ型
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

export interface MastersBundle {
  accounts: GasAccount[];
  taxes: GasTax[];
  departments: GasDepartment[];
  subAccounts: GasSubAccount[];
  projects: GasProject[];
  counterparties: GasCounterparty[];
}

// ===========================================
// 仕訳統計型
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

export interface MfMastersCache {
  accounts: { code: string | null; name: string; taxId?: number }[];
  taxes: { code: string | null; name: string; abbreviation?: string; taxRate?: number }[];
  subAccounts: { id: number; accountId: number; name: string }[];
  projects: { code: string | null; name: string }[];
  syncedAt: string;
}

// ===========================================
// MFマスタ取得
// ===========================================

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
