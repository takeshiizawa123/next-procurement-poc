/**
 * GAS Web App との連携クライアント
 *
 * GAS側の doPost(e) / doGet(e) でリクエストを受け取り、
 * スプレッドシートの読み書きを行う。
 *
 * 注意: GAS Web App は 302 リダイレクトを返すため、
 * fetch の redirect: "follow" で自動追従する。
 * ただし POST→リダイレクト時にボディが失われるため、
 * APIキーはクエリパラメータで送信する。
 */

const GAS_WEB_APP_URL = process.env.GAS_WEB_APP_URL || "";
const GAS_API_KEY = process.env.GAS_API_KEY || "";

export interface GasResponse<T = Record<string, unknown>> {
  success: boolean;
  data: T | null;
  error: string | null;
  statusCode: number;
  timestamp: string;
}

export interface RegisterResult {
  prNumber: string;
  rowNumber: number;
}

export interface UpdateResult {
  prNumber: string;
  rowNumber: number;
  updatedFields: string[];
}

export type PurchaseStatus = Record<string, unknown> & {
  購買番号: string;
  発注承認ステータス: string;
  発注ステータス: string;
  検収ステータス: string;
  _rowNumber: number;
};

/**
 * GAS Web App にPOSTリクエストを送信
 */
async function callGasPost<T = Record<string, unknown>>(
  action: string,
  payload: Record<string, unknown>,
): Promise<GasResponse<T>> {
  if (!GAS_WEB_APP_URL) {
    console.warn("[gas-client] GAS_WEB_APP_URL is not set. Skipping GAS call.");
    return {
      success: false,
      data: null,
      error: "GAS_WEB_APP_URL is not configured",
      statusCode: 0,
      timestamp: new Date().toISOString(),
    };
  }

  // APIキーはクエリパラメータ + bodyの両方に含める（リダイレクト対策）
  const url = `${GAS_WEB_APP_URL}?key=${encodeURIComponent(GAS_API_KEY)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
    body: JSON.stringify({ apiKey: GAS_API_KEY, action, ...payload }),
    redirect: "follow",
  });

  const text = await response.text();

  try {
    return JSON.parse(text) as GasResponse<T>;
  } catch {
    console.error("[gas-client] Failed to parse GAS response:", text.substring(0, 200));
    throw new Error(`GAS response is not valid JSON (status: ${response.status})`);
  }
}

/**
 * GAS Web App にGETリクエストを送信
 */
async function callGasGet<T = Record<string, unknown>>(
  params: Record<string, string>,
): Promise<GasResponse<T>> {
  if (!GAS_WEB_APP_URL) {
    console.warn("[gas-client] GAS_WEB_APP_URL is not set. Skipping GAS call.");
    return {
      success: false,
      data: null,
      error: "GAS_WEB_APP_URL is not configured",
      statusCode: 0,
      timestamp: new Date().toISOString(),
    };
  }

  const searchParams = new URLSearchParams({
    key: GAS_API_KEY,
    ...params,
  });
  const url = `${GAS_WEB_APP_URL}?${searchParams.toString()}`;

  const response = await fetch(url, { redirect: "follow" });
  const text = await response.text();

  try {
    return JSON.parse(text) as GasResponse<T>;
  } catch {
    console.error("[gas-client] Failed to parse GAS response:", text.substring(0, 200));
    throw new Error(`GAS response is not valid JSON (status: ${response.status})`);
  }
}

// ===========================================
// 公開API
// ===========================================

/**
 * 購買申請をスプレッドシートに新規登録
 */
export async function registerPurchase(data: {
  applicant: string;
  itemName: string;
  totalAmount: number;
  unitPrice?: number;
  quantity?: number;
  purchaseSource?: string;
  purchaseSourceUrl?: string;
  hubspotInfo?: string;
  budgetNumber?: string;
  paymentMethod?: string;
  approver?: string;
  deliveryDate?: string;
  purpose?: string;
  deliveryLocation?: string;
  useLocation?: string;
  poNumber?: string;
  accountTitle?: string;
  remarks?: string;
  slackTs?: string;
  slackLink?: string;
  isPurchased?: boolean;
  hasEvidence?: boolean;
}): Promise<GasResponse<RegisterResult>> {
  return callGasPost<RegisterResult>("register", data);
}

/**
 * 購買番号でステータスを照会
 */
export async function getStatus(
  prNumber: string,
): Promise<GasResponse<PurchaseStatus>> {
  return callGasGet<PurchaseStatus>({
    action: "status",
    prNumber,
  });
}

/**
 * 購買番号でステータスを更新
 */
export async function updateStatus(
  prNumber: string,
  updates: Record<string, string>,
): Promise<GasResponse<UpdateResult>> {
  return callGasPost<UpdateResult>("update", { prNumber, updates });
}

export interface Employee {
  name: string;
  departmentCode: string;
  departmentName: string;
  slackAliases: string;
}

/**
 * 従業員マスタ一覧を取得
 */
export async function getEmployees(): Promise<
  GasResponse<{ employees: Employee[] }>
> {
  return callGasGet<{ employees: Employee[] }>({ action: "employees" });
}

export interface DuplicateResult {
  prNumber: string;
  itemName: string;
  totalAmount: number;
  applicationDate: string;
  applicant: string;
  status: string;
}

export interface PastRequest {
  prNumber: string;
  applicationDate: string;
  itemName: string;
  totalAmount: number;
  unitPrice: number;
  quantity: number;
  supplierName: string;
  supplierUrl: string;
  applicant: string;
  paymentMethod: string;
  purpose: string;
}

/**
 * 重複チェック
 */
export async function checkDuplicate(
  itemName: string,
  totalAmount?: number,
): Promise<GasResponse<{ duplicates: DuplicateResult[] }>> {
  return callGasPost<{ duplicates: DuplicateResult[] }>("checkDuplicate", {
    itemName,
    ...(totalAmount ? { totalAmount } : {}),
  });
}

/**
 * 過去申請一覧を取得
 */
export async function getRecentRequests(
  applicant?: string,
  limit?: number,
): Promise<GasResponse<{ requests: PastRequest[] }>> {
  return callGasPost<{ requests: PastRequest[] }>("recentRequests", {
    ...(applicant ? { applicant } : {}),
    ...(limit ? { limit } : {}),
  });
}

/**
 * 購入先名一覧を取得（サジェスト用）
 */
export async function getSuppliers(): Promise<
  GasResponse<{ suppliers: string[] }>
> {
  return callGasGet<{ suppliers: string[] }>({ action: "suppliers" });
}

/**
 * GAS接続テスト（ヘルスチェック）
 */
export async function testConnection(): Promise<
  GasResponse<{ status: string; version: string }>
> {
  return callGasGet<{ status: string; version: string }>({ action: "health" });
}
