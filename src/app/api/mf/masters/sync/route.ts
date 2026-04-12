import { NextRequest, NextResponse } from "next/server";
import { getAccounts, getTaxes, getProjects, fetchSubAccounts } from "@/lib/mf-accounting";
import { requireBearerAuth, requireApiKey } from "@/lib/api-auth";

const GAS_WEB_APP_URL = (process.env.GAS_WEB_APP_URL || "").trim();
const GAS_API_KEY = process.env.GAS_API_KEY || "";

/**
 * MF APIマスタをGASスプレッドシートの個別シートに差分同期
 * POST /api/mf/masters/sync
 *
 * MF認証後にcallbackから呼ばれる
 */
export async function POST(request: NextRequest) {
  const bearerError = requireBearerAuth(request);
  const apiKeyError = requireApiKey(request);
  if (bearerError && apiKeyError) return apiKeyError;

  try {
    const [accounts, taxes, subAccounts, projects] = await Promise.all([
      getAccounts(),
      getTaxes(),
      fetchSubAccounts(),
      getProjects(),
    ]);

    const payload = {
      accounts: accounts.map((a) => ({
        id: a.id, code: a.code, name: a.name,
        search_key: a.search_key, tax_id: a.tax_id, available: a.available,
      })),
      taxes: taxes.map((t) => ({
        id: t.id, code: t.code, name: t.name,
        abbreviation: t.abbreviation, tax_rate: t.tax_rate, available: t.available,
      })),
      subAccounts: subAccounts.map((s) => ({
        id: s.id, code: s.code, account_id: s.account_id,
        name: s.name, search_key: s.search_key, available: s.available,
      })),
      projects: projects.map((p) => ({
        id: p.id, code: p.code, name: p.name,
        search_key: p.search_key, available: p.available,
      })),
    };

    // GASのsyncAllMfMastersFromApi アクションを呼び出し
    const res = await fetch(GAS_WEB_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: GAS_API_KEY,
        action: "syncMfMastersFromApi",
        ...payload,
      }),
    });

    const gasResult = await res.json();

    console.log("[mf-masters-sync] Synced to GAS sheets:", {
      accounts: payload.accounts.length,
      taxes: payload.taxes.length,
      subAccounts: payload.subAccounts.length,
      projects: payload.projects.length,
      gasSuccess: gasResult.success,
    });

    return NextResponse.json({
      ok: true,
      counts: {
        accounts: payload.accounts.length,
        taxes: payload.taxes.length,
        subAccounts: payload.subAccounts.length,
        projects: payload.projects.length,
      },
      savedToGas: gasResult.success,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[mf-masters-sync] Error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
