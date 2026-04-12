import { NextRequest, NextResponse } from "next/server";

const CRON_SECRET = process.env.CRON_SECRET || "";
const MF_EXPENSE_BASE = "https://expense.moneyforward.com/api/external/v1";
const MF_EXPENSE_OFFICE_ID = (process.env.MF_EXPENSE_OFFICE_ID || "").trim();
const MF_EXPENSE_TOKEN = (process.env.MF_EXPENSE_ACCESS_TOKEN || "").trim();

/**
 * MF経費APIの生レスポンスを調査するエンドポイント
 * GET /api/test/mf-expense-inspect?endpoint=ex_transactions
 *
 * 認証: Bearer CRON_SECRET
 *
 * 利用可能なendpoint:
 *  - ex_transactions: GET /me/ex_transactions
 *  - office_members: GET /office_members
 *  - ex_accounts: GET /me/ex_accounts (もし存在すれば)
 *  - me: GET /me
 */
export async function GET(request: NextRequest) {
  if (CRON_SECRET) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!MF_EXPENSE_TOKEN || !MF_EXPENSE_OFFICE_ID) {
    return NextResponse.json({
      error: "MF経費APIの環境変数が未設定です",
      env: {
        hasToken: !!MF_EXPENSE_TOKEN,
        hasOfficeId: !!MF_EXPENSE_OFFICE_ID,
      },
    }, { status: 500 });
  }

  const endpoint = request.nextUrl.searchParams.get("endpoint") || "ex_transactions";

  const fromDate = request.nextUrl.searchParams.get("from") || "2026-01-01";
  const toDate = request.nextUrl.searchParams.get("to") || "2026-04-10";

  // 公式APIドキュメントに基づく正しいパラメータ名: query_object[recognized_at_from]
  const dateFilter = `query_object[recognized_at_from]=${fromDate}&query_object[recognized_at_to]=${toDate}`;
  const endpointMap: Record<string, string> = {
    ex_transactions: `/offices/${MF_EXPENSE_OFFICE_ID}/me/ex_transactions?${dateFilter}`,
    ex_transactions_office: `/offices/${MF_EXPENSE_OFFICE_ID}/ex_transactions?${dateFilter}`,
    office_members: `/offices/${MF_EXPENSE_OFFICE_ID}/office_members`,
    ex_reports: `/offices/${MF_EXPENSE_OFFICE_ID}/ex_reports?${dateFilter}`,
  };

  const path = endpointMap[endpoint];
  if (!path) {
    return NextResponse.json({
      error: `Unknown endpoint: ${endpoint}`,
      available: Object.keys(endpointMap),
    }, { status: 400 });
  }

  const url = `${MF_EXPENSE_BASE}${path}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${MF_EXPENSE_TOKEN}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    const text = await res.text();
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.substring(0, 2000) };
    }

    // フィールド一覧抽出（最初の3レコードのキーを返す）
    let fieldsAnalysis: { sample_count: number; all_keys: string[]; first_record?: unknown } | null = null;
    if (Array.isArray(data)) {
      const allKeys = new Set<string>();
      data.slice(0, 5).forEach((item) => {
        if (item && typeof item === "object") {
          Object.keys(item as Record<string, unknown>).forEach((k) => allKeys.add(k));
        }
      });
      fieldsAnalysis = {
        sample_count: data.length,
        all_keys: Array.from(allKeys).sort(),
        first_record: data[0],
      };
    } else if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>;
      // ページング型レスポンス対応
      const arrayKey = Object.keys(obj).find((k) => Array.isArray(obj[k]));
      if (arrayKey) {
        const arr = obj[arrayKey] as unknown[];
        const allKeys = new Set<string>();
        arr.slice(0, 5).forEach((item) => {
          if (item && typeof item === "object") {
            Object.keys(item as Record<string, unknown>).forEach((k) => allKeys.add(k));
          }
        });
        fieldsAnalysis = {
          sample_count: arr.length,
          all_keys: Array.from(allKeys).sort(),
          first_record: arr[0],
        };
      } else {
        fieldsAnalysis = {
          sample_count: 1,
          all_keys: Object.keys(obj).sort(),
          first_record: obj,
        };
      }
    }

    return NextResponse.json({
      endpoint,
      url,
      status: res.status,
      ok: res.ok,
      fieldsAnalysis,
      // 本物のデータが欲しい場合は ?raw=true を付ける
      ...(request.nextUrl.searchParams.get("raw") === "true" ? { rawData: data } : {}),
    });
  } catch (e) {
    return NextResponse.json({
      error: e instanceof Error ? e.message : String(e),
      endpoint,
      url,
    }, { status: 500 });
  }
}
