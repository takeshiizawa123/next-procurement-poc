/**
 * MF経費API クライアント
 *
 * Sprint 3のMF会計Plus OAuth基盤を再利用。
 * 経費明細作成・マスタ取得を提供。
 * 参考: slack_mf_expense_bot_archive.md §2
 */

const MF_EXPENSE_BASE = "https://expense.moneyforward.com/api/external/v1";
// 環境変数に改行が混入していたケースがあるため trim
const MF_EXPENSE_OFFICE_ID = (process.env.MF_EXPENSE_OFFICE_ID || "").trim();

// MF経費は独自のBearer Tokenを使用（OAuth基盤とは別）
const MF_EXPENSE_TOKEN = (process.env.MF_EXPENSE_ACCESS_TOKEN || "").trim();

// --- 型定義 ---

export interface ExTransaction {
  value: number;
  recognized_at: string; // YYYY-MM-DD
  remark: string;
  memo?: string;
  ex_item_id?: string;
  project_id?: string;
  dept_id?: string;
}

/**
 * MF経費 ex_transactions API のレスポンス型
 * (fetchCardStatements / fetchEnrichedTransactions で取得)
 */
export interface MfExTransaction {
  id: string;
  number: number;
  value: number;
  recognized_at: string; // YYYY-MM-DD
  remark: string;
  memo: string | null;

  // 従業員特定（card_last4に依存しない主キー）
  office_member_id: string;
  office_member?: {
    id: string;
    name: string;
    identification_code: string;
    number: string;
  };

  // データソース識別
  automatic_status: string; // "manual" | "input_done" | "automatic" 等
  receipt_type: string | null; // "paper" | "e_doc" | null

  // 部門・PJ・科目
  dept_id: string | null;
  project_id: string | null;
  ex_item_id: string | null;
  dept?: { id: string; code: string; name: string };
  project?: { id: string; code: string; name: string } | null;
  ex_item?: { id: string; name: string; code: string };

  // 税区分・仕訳情報（既に仕訳化されている場合）
  dr_excise_id: string | null;
  dr_excise?: { id: string; long_name: string; rate: number };
  cr_item_id: string | null;
  cr_item?: { id: string; name: string; code: string };
  excise_value: number | null;

  // 適格請求書
  invoice_registration_number: string | null;
  invoice_kind: number | null;

  // 経費レポート関連
  is_exported: boolean;
  is_reported: boolean;
  approved_at: string | null;
  created_at: string;
  updated_at: string;

  // 添付ファイル
  mf_file?: {
    id: string;
    name: string;
    byte_size: number;
    content_type: string;
  } | null;
}

/**
 * カード照合用に正規化された形式
 */
export interface NormalizedCardStatement {
  /** MF経費側の取引ID */
  mfExTransactionId: string;
  /** 従業員ID（MF経費側） */
  officeMemberId: string;
  /** 従業員名 */
  memberName: string;
  /** 金額（円） */
  amount: number;
  /** 取引日 */
  date: string;
  /** 摘要（加盟店名など） */
  remark: string;
  /** メモ */
  memo: string | null;
  /** データソース: manual=手動入力, input_done=OCR読取済, automatic=カード自動取込 */
  source: string;
  /** レシート種別 */
  receiptType: string | null;
  /** 部門名 */
  deptName: string | null;
  /** PJ名 */
  projectName: string | null;
  /** 経費科目名 */
  exItemName: string | null;
  /** 適格請求書登録番号 */
  registrationNumber: string | null;
  /** 既存の仕訳情報（Stage 1相当） */
  stage1?: {
    drAccount: string;
    drTaxCode: string;
    crAccount: string;
    taxValue: number;
  };
}

interface MasterItem {
  id: string;
  name: string;
  code?: string;
}

// --- マスタキャッシュ ---

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const CACHE_TTL = 60 * 60 * 1000;
const cache: Record<string, CacheEntry<MasterItem[]>> = {};

// --- API通信 ---

async function expenseRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  if (!MF_EXPENSE_TOKEN || !MF_EXPENSE_OFFICE_ID) {
    throw new Error("MF経費APIの環境変数が未設定です（MF_EXPENSE_ACCESS_TOKEN, MF_EXPENSE_OFFICE_ID）");
  }

  const url = `${MF_EXPENSE_BASE}/offices/${MF_EXPENSE_OFFICE_ID}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${MF_EXPENSE_TOKEN}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MF Expense API error ${method} ${path} (${res.status}): ${text}`);
  }

  return res.json() as Promise<T>;
}

// --- 証憑アップロード（MF経費に自動転送） ---

export interface UploadReceiptResult {
  mf_files: Array<{ id: string; name: string }>;
  ex_transactions: Array<{ id: string; value: number; recognized_at: string }>;
}

/**
 * 証憑画像をMF経費にアップロード（OCR読取 + 経費明細自動作成）
 *
 * POST /offices/{oid}/me/upload_receipt
 * Content-Type: multipart/form-data
 */
export async function uploadReceiptToMfExpense(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<UploadReceiptResult> {
  if (!MF_EXPENSE_TOKEN || !MF_EXPENSE_OFFICE_ID) {
    throw new Error("MF経費APIの環境変数が未設定です");
  }

  const url = `${MF_EXPENSE_BASE}/offices/${MF_EXPENSE_OFFICE_ID}/me/upload_receipt`;

  const formData = new FormData();
  const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
  formData.append("receipt_input", blob, fileName);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MF_EXPENSE_TOKEN}`,
    },
    body: formData,
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MF Expense upload_receipt error (${res.status}): ${text}`);
  }

  return res.json() as Promise<UploadReceiptResult>;
}

// --- マスタAPI ---

async function fetchMaster(path: string): Promise<MasterItem[]> {
  const cached = cache[path];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.data;
  }

  const data = await expenseRequest<MasterItem[]>("GET", path);
  cache[path] = { data, fetchedAt: Date.now() };
  return data;
}

export async function getProjects(): Promise<MasterItem[]> {
  return fetchMaster("/projects");
}

export async function getDepts(): Promise<MasterItem[]> {
  return fetchMaster("/depts");
}

export async function getExItems(): Promise<MasterItem[]> {
  return fetchMaster("/ex_items");
}

/**
 * 経費科目名からIDを解決
 */
export async function resolveExItemId(name: string): Promise<string | undefined> {
  const items = await getExItems();
  const item = items.find((i) => i.name === name || i.name.includes(name));
  return item?.id;
}

/**
 * プロジェクトコードからIDを解決
 */
export async function resolveProjectId(codeOrName: string): Promise<string | undefined> {
  const items = await getProjects();
  const item =
    items.find((i) => i.code === codeOrName) ||
    items.find((i) => i.name === codeOrName) ||
    items.find((i) => i.name.includes(codeOrName));
  return item?.id;
}

/**
 * 部門名からIDを解決
 */
export async function resolveDeptId(name: string): Promise<string | undefined> {
  const items = await getDepts();
  const item = items.find((i) => i.name === name || i.name.includes(name));
  return item?.id;
}

// --- 経費明細作成 ---

/**
 * 経費明細を作成
 */
export async function createExTransaction(tx: ExTransaction): Promise<{ id: string }> {
  return expenseRequest<{ id: string }>("POST", "/me/ex_transactions", {
    ex_transaction: tx,
  });
}

/**
 * 出張申請から経費明細を作成
 */
export async function createTripExpense(params: {
  amount: number;
  date: string;
  destination: string;
  purpose: string;
  transport: string;
  projectCode?: string;
  deptName?: string;
}): Promise<{ id: string }> {
  const exItemId = await resolveExItemId("旅費交通費");
  const projectId = params.projectCode ? await resolveProjectId(params.projectCode) : undefined;
  const deptId = params.deptName ? await resolveDeptId(params.deptName) : undefined;

  return createExTransaction({
    value: params.amount,
    recognized_at: params.date,
    remark: `出張: ${params.destination}`,
    memo: `目的: ${params.purpose}\n交通: ${params.transport}`,
    ex_item_id: exItemId,
    project_id: projectId,
    dept_id: deptId,
  });
}

// ============================================================================
// カード明細取得（office_member_id ベースの照合に対応）
// ============================================================================

/**
 * MF経費からカード/経費明細を取得（全フィールド取得）
 *
 * Phase 0 の実装と違い、office_member_id / automatic_status / 仕訳情報などを含む
 * 全フィールドを取得して返す。
 *
 * @param options 取得オプション
 * @returns 正規化された明細リスト
 */
export async function fetchCardStatements(options: {
  /** 取得開始日 YYYY-MM-DD */
  from: string;
  /** 取得終了日 YYYY-MM-DD (from からの期間は最大3ヶ月) */
  to: string;
  /** ページング */
  page?: number;
  /** office_id内の全ユーザー分取得（管理者用）。false または未指定で /me のみ */
  officeWide?: boolean;
}): Promise<{
  statements: NormalizedCardStatement[];
  rawTransactions: MfExTransaction[];
  hasNextPage: boolean;
}> {
  if (!MF_EXPENSE_TOKEN || !MF_EXPENSE_OFFICE_ID) {
    console.warn("[mf-expense] MF_EXPENSE credentials not set");
    return { statements: [], rawTransactions: [], hasNextPage: false };
  }

  const basePath = options.officeWide
    ? `/offices/${MF_EXPENSE_OFFICE_ID}/ex_transactions`
    : `/offices/${MF_EXPENSE_OFFICE_ID}/me/ex_transactions`;

  const params = new URLSearchParams({
    "query_object[recognized_at_from]": options.from,
    "query_object[recognized_at_to]": options.to,
  });
  if (options.page && options.page > 1) {
    params.append("page", String(options.page));
  }

  const url = `${MF_EXPENSE_BASE}${basePath}?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${MF_EXPENSE_TOKEN}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`MF Expense API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  // レスポンスは配列 or { ex_transactions: [...], next: "...", prev: "..." }
  let rawList: MfExTransaction[];
  let hasNext = false;
  if (Array.isArray(data)) {
    rawList = data;
  } else {
    rawList = data.ex_transactions ?? [];
    hasNext = !!data.next;
  }

  const statements: NormalizedCardStatement[] = rawList
    .filter((tx) => tx.recognized_at && tx.value)
    .map((tx) => ({
      mfExTransactionId: tx.id,
      officeMemberId: tx.office_member_id,
      memberName: tx.office_member?.name ?? "",
      amount: tx.value,
      date: tx.recognized_at,
      remark: tx.remark ?? "",
      memo: tx.memo,
      source: tx.automatic_status ?? "unknown",
      receiptType: tx.receipt_type,
      deptName: tx.dept?.name ?? null,
      projectName: tx.project?.name ?? null,
      exItemName: tx.ex_item?.name ?? null,
      registrationNumber: tx.invoice_registration_number,
      stage1: tx.dr_excise
        ? {
            drAccount: tx.ex_item?.name ?? "",
            drTaxCode: tx.dr_excise.long_name,
            crAccount: tx.cr_item?.name ?? "",
            taxValue: tx.excise_value ?? 0,
          }
        : undefined,
    }));

  return { statements, rawTransactions: rawList, hasNextPage: hasNext };
}

/**
 * 指定期間の全カード明細を全ページ取得
 *
 * 期間が3ヶ月を超える場合は分割して取得。
 */
export async function fetchAllCardStatements(options: {
  from: string;
  to: string;
  officeWide?: boolean;
}): Promise<NormalizedCardStatement[]> {
  const all: NormalizedCardStatement[] = [];
  let page = 1;
  let hasNext = true;
  const MAX_PAGES = 20;

  while (hasNext && page <= MAX_PAGES) {
    const result = await fetchCardStatements({ ...options, page });
    all.push(...result.statements);
    hasNext = result.hasNextPage;
    page++;
  }

  return all;
}

// --- じゃらんCSVパーサー ---

export interface AccommodationRecord {
  checkoutDate: string;
  hotelName: string;
  amount: number;
  guestName: string;
  projectCode?: string;
  deptCode?: string;
  nights: number;
  reservationId?: string;
}

/**
 * じゃらんJCS CSV（CP932）をパース
 *
 * 注意: 実際のカラム名はじゃらん管理画面からのCSVに合わせて要調整
 */
export function parseJalanCsv(csvText: string): AccommodationRecord[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"/, "").replace(/"$/, ""));
  const records: AccommodationRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || "";
    });

    const amount = parseInt((row["合計料金"] || row["利用金額"] || "0").replace(/[,，]/g, ""), 10);
    if (!amount) continue;

    records.push({
      checkoutDate: normalizeDate(row["チェックアウト日"] || row["チェックアウト"]) || "",
      hotelName: row["宿名"] || row["施設名"] || "",
      amount,
      guestName: row["宿泊代表者名"] || row["利用者名"] || "",
      projectCode: row["法人専用項目1"] || row["プロジェクト番号"] || undefined,
      deptCode: row["法人専用項目2"] || row["部署"] || undefined,
      nights: parseInt(row["宿泊日数"] || row["泊数"] || "1", 10) || 1,
      reservationId: row["予約番号"] || undefined,
    });
  }

  return records;
}

/** CSV行をパース（引用符対応） */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/** 日付を YYYY-MM-DD に正規化 */
function normalizeDate(dateStr: string): string | null {
  if (!dateStr) return null;
  // YYYY/MM/DD or YYYY-MM-DD
  const m = dateStr.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return null;
}

/**
 * 宿泊レコードからMF経費明細を一括作成
 */
export async function importAccommodationRecords(
  records: AccommodationRecord[],
  dryRun = false,
): Promise<{ imported: number; errors: string[] }> {
  const exItemId = await resolveExItemId("宿泊費") || await resolveExItemId("旅費交通費");
  let imported = 0;
  const errors: string[] = [];

  for (const rec of records) {
    const projectId = rec.projectCode ? await resolveProjectId(rec.projectCode) : undefined;
    const deptId = rec.deptCode ? await resolveDeptId(rec.deptCode) : undefined;

    if (dryRun) {
      console.log("[csv-import] DRY RUN:", rec);
      imported++;
      continue;
    }

    try {
      await createExTransaction({
        value: rec.amount,
        recognized_at: rec.checkoutDate,
        remark: `宿泊: ${rec.hotelName}`,
        memo: `宿泊者: ${rec.guestName}\n泊数: ${rec.nights}${rec.reservationId ? `\n予約番号: ${rec.reservationId}` : ""}`,
        ex_item_id: exItemId,
        project_id: projectId,
        dept_id: deptId,
      });
      imported++;
    } catch (e) {
      errors.push(`${rec.reservationId || rec.hotelName}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { imported, errors };
}
