/**
 * GAS Web App との連携クライアント
 *
 * GAS側の doPost(e) でリクエストを受け取り、
 * スプレッドシートの読み書きを行う想定。
 */

const GAS_WEB_APP_URL = process.env.GAS_WEB_APP_URL || "";
const GAS_API_KEY = process.env.GAS_API_KEY || "";

interface GasResponse {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * GAS Web App にPOSTリクエストを送信
 */
async function callGas(
  action: string,
  payload: Record<string, unknown>
): Promise<GasResponse> {
  if (!GAS_WEB_APP_URL) {
    console.warn("GAS_WEB_APP_URL is not set. Returning mock response.");
    return { success: true, data: { mock: true, action, ...payload } };
  }

  const response = await fetch(GAS_WEB_APP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      apiKey: GAS_API_KEY,
      action,
      ...payload,
    }),
  });

  if (!response.ok) {
    throw new Error(`GAS request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as GasResponse;
}

/**
 * スプレッドシートのステータスを更新
 */
export async function updatePurchaseStatus(
  poNumber: string,
  status: string,
  updatedBy: string
): Promise<GasResponse> {
  return callGas("updateStatus", {
    poNumber,
    status,
    updatedBy,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * 購買申請データを取得
 */
export async function getPurchaseRequest(
  poNumber: string
): Promise<GasResponse> {
  return callGas("getRequest", { poNumber });
}

/**
 * 新規購買申請をスプレッドシートに登録
 */
export async function createPurchaseRequest(data: {
  poNumber: string;
  itemName: string;
  amount: number;
  applicantId: string;
  applicantName: string;
  department: string;
  paymentMethod: string;
}): Promise<GasResponse> {
  return callGas("createRequest", data);
}

/**
 * GAS接続テスト
 */
export async function testGasConnection(): Promise<GasResponse> {
  return callGas("ping", {});
}
