import { NextRequest, NextResponse } from "next/server";
import { getAccounts, getTaxes, getDepartments, fetchSubAccounts } from "@/lib/mf-accounting";
import { requireApiKey, requireBearerAuth } from "@/lib/api-auth";

/**
 * MF会計Plusマスタデータ一括取得API
 * GET /api/mf/masters
 *
 * OpenAPI仕様: docs/api-specs/openapi.yaml
 * - /masters/accounts → 勘定科目（id, code, name, tax_id, categories, available）
 * - /masters/taxes → 税区分（id, code, name, abbreviation, tax_rate, available）
 * - /masters/departments → 部門（id, code, name, available）
 * - /masters/sub_accounts → 補助科目（id, code, account_id, name, available）
 */
export async function GET(request: NextRequest) {
  const bearerError = requireBearerAuth(request);
  const apiKeyError = requireApiKey(request);
  if (bearerError && apiKeyError) return apiKeyError;

  try {
    const [accounts, taxes, departments, subAccounts] = await Promise.all([
      getAccounts(),
      getTaxes(),
      getDepartments(),
      fetchSubAccounts(),
    ]);

    return NextResponse.json({
      ok: true,
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
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[mf-masters] Error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
