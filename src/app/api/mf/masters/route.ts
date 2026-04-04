import { NextRequest, NextResponse } from "next/server";
import {
  getAccounts, getTaxes, getProjects, fetchSubAccounts,
} from "@/lib/mf-accounting";
import { getGasCounterparties, getGasDepartments, getMfMasters } from "@/lib/gas-client";
import { requireApiKey, requireBearerAuth } from "@/lib/api-auth";

/**
 * MF会計Plusマスタデータ一括取得API
 * GET /api/mf/masters
 *
 * 取引先・部門: GASスプレッドシートから取得（MF認証不要）
 * 勘定科目・税区分・PJ・補助科目: GAS JSONキャッシュ → MF APIフォールバック
 */
export async function GET(request: NextRequest) {
  const bearerError = requireBearerAuth(request);
  const apiKeyError = requireApiKey(request);
  if (bearerError && apiKeyError) return apiKeyError;

  // 1. 取引先・部門をGASシートから取得（常に利用可能）
  const [cpResult, deptResult] = await Promise.all([
    getGasCounterparties().catch(() => null),
    getGasDepartments().catch(() => null),
  ]);

  const counterparties = (cpResult?.success && cpResult.data?.counterparties || [])
    .filter((c) => c.available)
    .map((c) => ({
      code: c.code,
      name: c.name,
      invoiceRegistrationNumber: c.invoiceRegistrationNumber || null,
    }));

  const departments = (deptResult?.success && deptResult.data?.departments || [])
    .filter((d) => d.available)
    .map((d) => ({ code: d.code, name: d.name }));

  // 2. 勘定科目・税区分・PJ・補助科目: GAS JSONキャッシュを試行
  let accounts: { code: string | null; name: string; taxId?: number }[] = [];
  let taxes: { code: string | null; name: string; abbreviation?: string; taxRate?: number }[] = [];
  let subAccounts: { id: number; accountId: number; name: string }[] = [];
  let projects: { code: string | null; name: string }[] = [];
  let source = "none";

  try {
    const cacheResult = await getMfMasters();
    if (cacheResult.success && cacheResult.data?.masters?.accounts?.length) {
      const m = cacheResult.data.masters;
      accounts = m.accounts;
      taxes = m.taxes;
      subAccounts = m.subAccounts;
      projects = m.projects;
      source = `gas-cache (${m.syncedAt})`;
    }
  } catch { /* cache miss */ }

  // 3. キャッシュになければMF APIから直接取得
  if (accounts.length === 0) {
    try {
      const [accts, txs, subs, pjs] = await Promise.all([
        getAccounts(), getTaxes(), fetchSubAccounts(), getProjects(),
      ]);
      accounts = accts.filter((a) => a.available !== false).map((a) => ({
        code: a.code, name: a.name, taxId: a.tax_id,
      }));
      taxes = txs.filter((t) => t.available !== false).map((t) => ({
        code: t.code, name: t.name, abbreviation: t.abbreviation, taxRate: t.tax_rate,
      }));
      subAccounts = subs.filter((s) => s.available !== false).map((s) => ({
        id: s.id, accountId: s.account_id, name: s.name,
      }));
      projects = pjs.filter((p) => p.available !== false).map((p) => ({
        code: p.code, name: p.name,
      }));
      source = "mf-api";
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // 取引先・部門だけでもあれば部分成功として返す
      if (counterparties.length > 0 || departments.length > 0) {
        console.warn("[mf-masters] MF API failed, returning GAS data only:", msg);
        source = "gas-only";
      } else {
        console.error("[mf-masters] All sources failed:", msg);
        return NextResponse.json({ ok: false, error: msg }, { status: 500 });
      }
    }
  }

  console.log("[mf-masters] source:", source, "counterparties:", counterparties.length, "departments:", departments.length, "accounts:", accounts.length);

  return NextResponse.json({
    ok: true,
    source,
    accounts,
    taxes,
    departments,
    subAccounts,
    projects,
    counterparties,
  });
}
