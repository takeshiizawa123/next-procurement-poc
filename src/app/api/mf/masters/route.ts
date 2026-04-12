import { NextRequest, NextResponse } from "next/server";
import { getMastersBundle } from "@/lib/gas-client";
import { requireApiKey, requireBearerAuth } from "@/lib/api-auth";

/**
 * MF会計Plusマスタデータ一括取得API
 * GET /api/mf/masters
 *
 * GAS 1回の呼び出しで全マスタを取得（旧: 6回の個別呼び出し）
 */
export async function GET(request: NextRequest) {
  const bearerError = requireBearerAuth(request);
  const apiKeyError = requireApiKey(request);
  if (bearerError && apiKeyError) return apiKeyError;

  const bundleResult = await getMastersBundle().catch(() => null);

  const raw = bundleResult?.success && bundleResult.data ? bundleResult.data : null;

  const counterparties = (raw?.counterparties || [])
    .filter((c) => c.available)
    .map((c) => ({
      code: c.code,
      name: c.name,
      invoiceRegistrationNumber: c.invoiceRegistrationNumber || null,
    }));

  const departments = (raw?.departments || [])
    .filter((d) => d.available)
    .map((d) => ({ code: d.code, name: d.name }));

  const accounts = (raw?.accounts || [])
    .filter((a) => a.available)
    .map((a) => ({ code: a.code, name: a.name, taxId: a.taxId }));

  const taxes = (raw?.taxes || [])
    .filter((t) => t.available)
    .map((t) => ({ code: t.code, name: t.name, abbreviation: t.abbreviation, taxRate: t.taxRate }));

  const subAccounts = (raw?.subAccounts || [])
    .filter((s) => s.available)
    .map((s) => ({ id: Number(s.mfId), accountId: s.accountId, name: s.name }));

  const projects = (raw?.projects || [])
    .filter((p) => p.available)
    .map((p) => ({ code: p.code, name: p.name }));

  console.log(
    "[mf-masters] bundle",
    "counterparties:", counterparties.length,
    "departments:", departments.length,
    "accounts:", accounts.length,
    "taxes:", taxes.length,
    "subAccounts:", subAccounts.length,
    "projects:", projects.length,
  );

  const res = NextResponse.json({
    ok: true,
    source: "gas-bundle",
    accounts,
    taxes,
    departments,
    subAccounts,
    projects,
    counterparties,
  });
  // マスタは変更頻度が低い → CDNで10分キャッシュ + 4時間stale
  res.headers.set("Cache-Control", "public, s-maxage=600, stale-while-revalidate=14400");
  return res;
}
