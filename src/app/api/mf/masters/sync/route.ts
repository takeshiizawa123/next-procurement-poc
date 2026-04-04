import { NextRequest, NextResponse } from "next/server";
import { getAccounts, getTaxes, getProjects, fetchSubAccounts } from "@/lib/mf-accounting";
import { saveMfMasters } from "@/lib/gas-client";
import { requireBearerAuth, requireApiKey } from "@/lib/api-auth";

/**
 * MF APIマスタ（勘定科目・税区分・PJ・補助科目）をGASにJSONキャッシュ保存
 * POST /api/mf/masters/sync
 *
 * 取引先・部門はGASスプレッドシートに既存のため対象外
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

    const masters = {
      accounts: accounts.filter((a) => a.available !== false).map((a) => ({
        code: a.code, name: a.name, taxId: a.tax_id,
      })),
      taxes: taxes.filter((t) => t.available !== false).map((t) => ({
        code: t.code, name: t.name, abbreviation: t.abbreviation, taxRate: t.tax_rate,
      })),
      subAccounts: subAccounts.filter((s) => s.available !== false).map((s) => ({
        id: s.id, accountId: s.account_id, name: s.name,
      })),
      projects: projects.filter((p) => p.available !== false).map((p) => ({
        code: p.code, name: p.name,
      })),
      syncedAt: new Date().toISOString(),
    };

    const gasResult = await saveMfMasters(masters);

    console.log("[mf-masters-sync] Synced:", {
      accounts: masters.accounts.length,
      taxes: masters.taxes.length,
      subAccounts: masters.subAccounts.length,
      projects: masters.projects.length,
      savedToGas: gasResult.success,
    });

    return NextResponse.json({
      ok: true,
      counts: {
        accounts: masters.accounts.length,
        taxes: masters.taxes.length,
        subAccounts: masters.subAccounts.length,
        projects: masters.projects.length,
      },
      savedToGas: gasResult.success,
      syncedAt: masters.syncedAt,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[mf-masters-sync] Error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
