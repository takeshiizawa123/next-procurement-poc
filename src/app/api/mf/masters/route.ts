import { NextRequest, NextResponse } from "next/server";
import {
  getAccounts, getTaxes, getDepartments, getProjects,
  getCounterparties, fetchSubAccounts,
} from "@/lib/mf-accounting";
import { getMfMasters } from "@/lib/gas-client";
import { requireApiKey, requireBearerAuth } from "@/lib/api-auth";

/**
 * MF会計Plusマスタデータ一括取得API
 * GET /api/mf/masters
 *
 * 1. GASキャッシュから取得（MF認証不要）
 * 2. GASになければMF APIから直接取得（MF認証必要）
 */
export async function GET(request: NextRequest) {
  const bearerError = requireBearerAuth(request);
  const apiKeyError = requireApiKey(request);
  if (bearerError && apiKeyError) return apiKeyError;

  // 1. GASキャッシュから取得を試行
  try {
    const gasResult = await getMfMasters();
    if (gasResult.success && gasResult.data?.masters) {
      const m = gasResult.data.masters;
      if (m.accounts?.length > 0) {
        console.log("[mf-masters] Loaded from GAS cache (synced:", m.syncedAt, ")");
        return NextResponse.json({
          ok: true,
          source: "gas",
          syncedAt: m.syncedAt,
          accounts: m.accounts,
          taxes: m.taxes,
          departments: m.departments,
          subAccounts: m.subAccounts,
          projects: m.projects,
          counterparties: m.counterparties,
        });
      }
    }
  } catch (e) {
    console.warn("[mf-masters] GAS cache miss:", e instanceof Error ? e.message : "");
  }

  // 2. GASになければMF APIから直接取得
  try {
    const [accounts, taxes, departments, subAccounts, projects, counterparties] = await Promise.all([
      getAccounts(),
      getTaxes(),
      getDepartments(),
      fetchSubAccounts(),
      getProjects(),
      getCounterparties(),
    ]);

    return NextResponse.json({
      ok: true,
      source: "mf-api",
      accounts: accounts
        .filter((a) => a.available !== false)
        .map((a) => ({
          code: a.code,
          name: a.name,
          taxId: a.tax_id,
          categories: a.categories,
        })),
      taxes: taxes
        .filter((t) => t.available !== false)
        .map((t) => ({
          code: t.code,
          name: t.name,
          abbreviation: t.abbreviation,
          taxRate: t.tax_rate,
        })),
      departments: departments
        .filter((d) => d.available !== false)
        .map((d) => ({ code: d.code, name: d.name })),
      subAccounts: subAccounts
        .filter((s) => s.available !== false)
        .map((s) => ({ id: s.id, accountId: s.account_id, name: s.name })),
      projects: projects
        .filter((p) => p.available !== false)
        .map((p) => ({ code: p.code, name: p.name })),
      counterparties: counterparties
        .map((c) => ({
          code: c.code,
          name: c.name,
          invoiceRegistrationNumber: c.invoice_registration_number,
        })),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[mf-masters] Error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
