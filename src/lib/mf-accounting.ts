/**
 * MF会計Plus API クライアント
 *
 * 仕訳登録・マスタ取得を提供。
 * アーカイブ: procureflow_agent_archive.md §4 を参照。
 */

import { getValidAccessToken, forceRefreshToken } from "./mf-oauth";

const API_BASE = "https://api-enterprise-accounting.moneyforward.com/api/v3";

// --- 型定義 ---

interface BranchSide {
  account_code?: string;
  tax_code?: string;
  sub_account_code?: string;
  department_code?: string;
  project_code?: string;
  counterparty_code?: string;
  value: number;
  tax_value?: number;
}

interface JournalBranch {
  remark?: string;
  debitor: BranchSide;
  creditor: BranchSide;
}

export interface CreateJournalRequest {
  status: "draft" | "approved";
  transaction_date: string; // YYYY-MM-DD
  journal_type: "journal_entry" | "adjusting_entry";
  tags?: string[];
  memo?: string;
  branches: JournalBranch[];
}

export interface JournalResponse {
  id: number;
  url?: string;
}

interface MasterItem {
  id: number;
  code: string;
  name: string;
  search_key?: string;
}

// --- マスタキャッシュ (1時間TTL) ---

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const CACHE_TTL = 60 * 60 * 1000; // 1時間
const masterCache: Record<string, CacheEntry<MasterItem[]>> = {};

// --- 認証済みリクエスト ---

async function authenticatedRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  isRetry = false,
): Promise<T> {
  const token = await getValidAccessToken();

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401 && !isRetry) {
    // トークン期限切れ → リフレッシュして1回リトライ
    await forceRefreshToken();
    return authenticatedRequest<T>(method, path, body, true);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MF API error ${method} ${path} (${res.status}): ${text}`);
  }

  return res.json() as Promise<T>;
}

// --- マスタAPI ---

async function fetchMaster(endpoint: string): Promise<MasterItem[]> {
  const cached = masterCache[endpoint];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.data;
  }

  const data = await authenticatedRequest<{ data: MasterItem[] }>("GET", endpoint);
  const items = data.data || [];
  masterCache[endpoint] = { data: items, fetchedAt: Date.now() };
  return items;
}

export async function getAccounts(): Promise<MasterItem[]> {
  return fetchMaster("/masters/accounts");
}

export async function getTaxes(): Promise<MasterItem[]> {
  return fetchMaster("/masters/taxes");
}

export async function getDepartments(): Promise<MasterItem[]> {
  return fetchMaster("/masters/departments");
}

/**
 * 名前 or コードからマスタIDを解決
 * 優先順位: code完全一致 → name完全一致 → name部分一致
 */
function resolveMasterItem(items: MasterItem[], nameOrCode: string): MasterItem | null {
  if (!nameOrCode) return null;
  const q = nameOrCode.trim();
  return (
    items.find((i) => i.code === q) ||
    items.find((i) => i.name === q) ||
    items.find((i) => i.name.includes(q)) ||
    items.find((i) => i.search_key?.includes(q)) ||
    null
  );
}

export async function resolveAccountCode(nameOrCode: string): Promise<string | undefined> {
  const items = await getAccounts();
  return resolveMasterItem(items, nameOrCode)?.code;
}

export async function resolveTaxCode(nameOrCode: string): Promise<string | undefined> {
  const items = await getTaxes();
  return resolveMasterItem(items, nameOrCode)?.code;
}

export async function resolveDepartmentCode(nameOrCode: string): Promise<string | undefined> {
  const items = await getDepartments();
  return resolveMasterItem(items, nameOrCode)?.code;
}

// --- 仕訳CRUD ---

/**
 * 仕訳を作成
 */
export async function createJournal(request: CreateJournalRequest): Promise<JournalResponse> {
  return authenticatedRequest<JournalResponse>("POST", "/journals", request);
}

/**
 * 購買申請データから仕訳リクエストを構築
 *
 * 基本パターン:
 *   借方: 費用科目（消耗品費等）
 *   貸方: 未払金（カード払い）or 買掛金（請求書払い）
 */
export async function buildJournalFromPurchase(params: {
  transactionDate: string;
  accountTitle: string;
  amount: number;
  paymentMethod: string;
  supplierName: string;
  department?: string;
  poNumber: string;
  memo?: string;
}): Promise<CreateJournalRequest> {
  const {
    transactionDate,
    accountTitle,
    amount,
    paymentMethod,
    supplierName,
    department,
    poNumber,
    memo,
  } = params;

  // 借方: 費用科目を解決
  // accountTitle は "消耗品費（事務用品）" のような形式
  const mainAccount = accountTitle.split("（")[0].trim();
  const debitAccountCode = await resolveAccountCode(mainAccount);

  // 貸方: 支払方法に応じた科目
  const isCard = paymentMethod.includes("カード");
  const creditAccountName = isCard ? "未払金" : "買掛金";
  const creditAccountCode = await resolveAccountCode(creditAccountName);

  // 税区分
  const taxCode = await resolveTaxCode("課税仕入10%");

  // 部門
  const departmentCode = department ? await resolveDepartmentCode(department) : undefined;

  // 税込金額から税額を計算（10%税率想定）
  const taxValue = Math.floor(amount * 10 / 110);

  return {
    status: "draft",
    transaction_date: transactionDate,
    journal_type: "journal_entry",
    tags: [poNumber],
    memo: memo || `${poNumber} ${supplierName}`,
    branches: [
      {
        remark: `${poNumber} ${supplierName}${memo ? ` ${memo}` : ""}`,
        debitor: {
          account_code: debitAccountCode || mainAccount,
          tax_code: taxCode,
          department_code: departmentCode,
          value: amount,
          tax_value: taxValue,
        },
        creditor: {
          account_code: creditAccountCode || creditAccountName,
          value: amount,
        },
      },
    ],
  };
}

// --- 勘定科目マッピング（フォールバック用） ---

export const EXPENSE_ACCOUNT_MAP: Record<string, { account: string; taxType: string }> = {
  消耗品費: { account: "消耗品費", taxType: "課税仕入10%" },
  工具器具備品: { account: "工具器具備品", taxType: "課税仕入10%" },
  ソフトウェア: { account: "ソフトウェア", taxType: "課税仕入10%" },
  外注費: { account: "外注費", taxType: "課税仕入10%" },
  広告宣伝費: { account: "広告宣伝費", taxType: "課税仕入10%" },
  旅費交通費: { account: "旅費交通費", taxType: "課税仕入10%" },
  通信費: { account: "通信費", taxType: "課税仕入10%" },
  地代家賃: { account: "地代家賃", taxType: "非課税" },
  雑費: { account: "雑費", taxType: "課税仕入10%" },
};
