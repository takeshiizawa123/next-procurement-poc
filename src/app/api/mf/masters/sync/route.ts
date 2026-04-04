import { NextRequest, NextResponse } from "next/server";
import {
  getAccounts, getTaxes, getDepartments, getProjects,
  getCounterparties, fetchSubAccounts,
} from "@/lib/mf-accounting";
import { saveMfMasters } from "@/lib/gas-client";
import { requireBearerAuth, requireApiKey } from "@/lib/api-auth";

/**
 * MFマスタデータをMF会計APIから取得し、GASに保存
 * POST /api/mf/masters/sync
 *
 * MF認証後に自動呼出し、または手動トリガー用
 */
export async function POST(request: NextRequest) {
  const bearerError = requireBearerAuth(request);
  const apiKeyError = requireApiKey(request);
  if (bearerError && apiKeyError) return apiKeyError;

  try {
    const [accounts, taxes, departments, subAccounts, projects, counterparties] = await Promise.all([
      getAccounts(),
      getTaxes(),
      getDepartments(),
      fetchSubAccounts(),
      getProjects(),
      getCounterparties(),
    ]);

    const masters = {
      accounts: accounts.filter((a) => a.available !== false).map((a) => ({
        code: a.code, name: a.name, taxId: a.tax_id,
      })),
      taxes: taxes.filter((t) => t.available !== false).map((t) => ({
        code: t.code, name: t.name, abbreviation: t.abbreviation, taxRate: t.tax_rate,
      })),
      departments: departments.filter((d) => d.available !== false).map((d) => ({
        code: d.code, name: d.name,
      })),
      subAccounts: subAccounts.filter((s) => s.available !== false).map((s) => ({
        id: s.id, accountId: s.account_id, name: s.name,
      })),
      projects: projects.filter((p) => p.available !== false).map((p) => ({
        code: p.code, name: p.name,
      })),
      counterparties: counterparties.map((c) => ({
        code: c.code, name: c.name, invoiceRegistrationNumber: c.invoice_registration_number,
      })),
      syncedAt: new Date().toISOString(),
    };

    // GASに保存
    const gasResult = await saveMfMasters(masters);
    const savedToGas = gasResult.success;

    console.log("[mf-masters-sync] Synced:", {
      accounts: masters.accounts.length,
      taxes: masters.taxes.length,
      departments: masters.departments.length,
      projects: masters.projects.length,
      counterparties: masters.counterparties.length,
      savedToGas,
    });

    return NextResponse.json({
      ok: true,
      counts: {
        accounts: masters.accounts.length,
        taxes: masters.taxes.length,
        departments: masters.departments.length,
        subAccounts: masters.subAccounts.length,
        projects: masters.projects.length,
        counterparties: masters.counterparties.length,
      },
      savedToGas,
      syncedAt: masters.syncedAt,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[mf-masters-sync] Error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
