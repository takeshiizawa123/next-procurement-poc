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
    signal: AbortSignal.timeout(15000),
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

// --- 補助科目マスタ ---

interface SubAccountItem {
  id: number;
  code: string | null;
  account_id: number;
  name: string;
  search_key?: string | null;
  available: boolean;
}

const subAccountCache: CacheEntry<SubAccountItem[]> | null = null;

async function fetchSubAccounts(): Promise<SubAccountItem[]> {
  if (subAccountCache && Date.now() - subAccountCache.fetchedAt < CACHE_TTL) {
    return subAccountCache.data;
  }

  const data = await authenticatedRequest<{ sub_accounts: SubAccountItem[] }>(
    "GET",
    "/masters/sub_accounts",
  );
  const items = data.sub_accounts || [];
  // キャッシュは masterCache と同じ仕組みで管理
  masterCache["_sub_accounts"] = {
    data: items as unknown as MasterItem[],
    fetchedAt: Date.now(),
  };
  return items;
}

/**
 * 補助科目コードを解決
 * 親科目名 + 補助科目名 で検索（例: "未払金", "MFカード:未請求"）
 */
export async function resolveSubAccountCode(
  parentAccountName: string,
  subAccountName: string,
): Promise<string | undefined> {
  const accounts = await getAccounts();
  const parentAccount = resolveMasterItem(accounts, parentAccountName);
  if (!parentAccount) return undefined;

  const subAccounts = await fetchSubAccounts();
  const parentId = parentAccount.id;
  const candidates = subAccounts.filter((sa) => sa.account_id === parentId && sa.available);

  const match =
    candidates.find((sa) => sa.code === subAccountName) ||
    candidates.find((sa) => sa.name === subAccountName) ||
    candidates.find((sa) => sa.name.includes(subAccountName)) ||
    candidates.find((sa) => sa.search_key?.includes(subAccountName)) ||
    null;

  return match?.code ?? undefined;
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

/** 仕訳一覧の1件 */
export interface JournalListItem {
  id: number;
  transaction_date: string;
  status: string;
  entered_by: string | null;
  memo: string | null;
  tags: string[];
  branches: {
    remark: string | null;
    debitor: BranchSide & { account_name?: string; sub_account_name?: string };
    creditor: BranchSide & { account_name?: string; sub_account_name?: string };
  }[];
}

/**
 * 仕訳一覧を取得
 *
 * @param params.from 開始日 (YYYY-MM-DD)
 * @param params.to   終了日 (YYYY-MM-DD)
 * @param params.enteredBy "none" で自動仕訳（カード明細由来 = Stage 2）のみ取得
 */
export async function getJournals(params: {
  from: string;
  to: string;
  enteredBy?: string;
}): Promise<JournalListItem[]> {
  const query = new URLSearchParams({
    from: params.from,
    to: params.to,
    ...(params.enteredBy ? { entered_by: params.enteredBy } : {}),
  });
  const data = await authenticatedRequest<{ journals: JournalListItem[] }>(
    "GET",
    `/journals?${query.toString()}`,
  );
  return data.journals || [];
}

/**
 * 仕訳を作成
 */
export async function createJournal(request: CreateJournalRequest): Promise<JournalResponse> {
  return authenticatedRequest<JournalResponse>("POST", "/journals", request);
}

/**
 * 支払方法から貸方科目・補助科目を解決
 *
 * 会社カード → 未払金 / MFカード:未請求（Stage 1）
 * 請求書払い → 買掛金（補助科目なし）
 * 従業員立替 → この関数は呼ばれない（MF経費経由）
 */
async function resolveCreditAccount(paymentMethod: string): Promise<{
  accountCode: string;
  accountName: string;
  subAccountCode?: string;
}> {
  const isCard = paymentMethod.includes("カード");
  const accountName = isCard ? "未払金" : "買掛金";
  const accountCode = await resolveAccountCode(accountName);

  let subAccountCode: string | undefined;
  if (isCard) {
    // カード払い: 補助科目 "MFカード:未請求" を設定（Stage 1仕訳）
    subAccountCode = await resolveSubAccountCode("未払金", "MFカード:未請求");
  }

  return {
    accountCode: accountCode || accountName,
    accountName,
    subAccountCode,
  };
}

/**
 * 購買申請データから仕訳リクエストを構築
 *
 * 基本パターン:
 *   借方: 費用科目（消耗品費等）
 *   貸方: 未払金(MFカード:未請求)（カード払い）or 買掛金（請求書払い）
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

  // 貸方: 支払方法に応じた科目 + 補助科目
  const credit = await resolveCreditAccount(paymentMethod);

  // 税区分 — 科目に対応する税区分を解決
  const expenseMapping = EXPENSE_ACCOUNT_MAP[mainAccount];
  const taxTypeName = expenseMapping?.taxType || "共-課仕 10%";
  const taxCode = await resolveTaxCode(taxTypeName);

  // 部門
  const departmentCode = department ? await resolveDepartmentCode(department) : undefined;

  // 税込金額から税額を計算（税区分名から税率を解決）
  const taxRatePercent = TAX_RATE_MAP[taxTypeName] ?? 10;
  const taxValue = taxRatePercent > 0 ? Math.floor(amount * taxRatePercent / (100 + taxRatePercent)) : 0;

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
          account_code: credit.accountCode,
          sub_account_code: credit.subAccountCode,
          value: amount,
        },
      },
    ],
  };
}

// --- 税率マッピング ---

const TAX_RATE_MAP: Record<string, number> = {
  "課仕 10%": 10,
  "共-課仕 10%": 10,
  "課仕 8%": 8,
  "共-課仕 8%": 8,
  "課税仕入10%": 10,
  "課税仕入8%": 8,
  "課税仕入8%(軽)": 8,
  "非課税": 0,
  "不課税": 0,
  "対象外": 0,
  "免税": 0,
};

// --- 勘定科目マッピング（フォールバック用） ---
// 税区分はFS税区分（科目マスタCSV）に準拠
// 販管費 → 共-課仕 10%（共通対応）、製造原価 → 課仕 10%（課税売上対応）
// ※現在は売上5億未満で全額控除のため実質影響なしだが、正しい区分を維持

export const EXPENSE_ACCOUNT_MAP: Record<string, { account: string; taxType: string }> = {
  // 販売費及び一般管理費（共通対応）
  消耗品費: { account: "消耗品費", taxType: "共-課仕 10%" },
  備品消耗品費: { account: "備品消耗品費", taxType: "共-課仕 10%" },
  事務用消耗品費: { account: "事務用消耗品費", taxType: "共-課仕 10%" },
  工具器具備品: { account: "工具器具備品", taxType: "共-課仕 10%" },
  ソフトウェア: { account: "ソフトウェア", taxType: "共-課仕 10%" },
  外注費: { account: "外注費", taxType: "共-課仕 10%" },
  業務委託費: { account: "業務委託費", taxType: "共-課仕 10%" },
  広告宣伝費: { account: "広告宣伝費", taxType: "共-課仕 10%" },
  旅費交通費: { account: "旅費交通費", taxType: "共-課仕 10%" },
  通信費: { account: "通信費", taxType: "共-課仕 10%" },
  地代家賃: { account: "地代家賃", taxType: "共-課仕 10%" },
  雑費: { account: "雑費", taxType: "共-課仕 10%" },
  研究開発費: { account: "研究開発費", taxType: "共-課仕 10%" },
  管理諸費: { account: "管理諸費", taxType: "共-課仕 10%" },
  会議費: { account: "会議費", taxType: "共-課仕 10%" },
  接待交際費: { account: "接待交際費", taxType: "共-課仕 10%" },
  修繕費: { account: "修繕費", taxType: "共-課仕 10%" },
  // 研究開発費の材料費（販管費・共通対応）
  材料費: { account: "材料費", taxType: "共-課仕 10%" },
  材料仕入: { account: "材料仕入", taxType: "共-課仕 10%" },
};
