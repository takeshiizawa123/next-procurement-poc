/**
 * MF経費API クライアント
 *
 * Sprint 3のMF会計Plus OAuth基盤を再利用。
 * 経費明細作成・マスタ取得を提供。
 * 参考: slack_mf_expense_bot_archive.md §2
 */

const MF_EXPENSE_BASE = "https://expense.moneyforward.com/api/external/v1";
const MF_EXPENSE_OFFICE_ID = process.env.MF_EXPENSE_OFFICE_ID || "";

// MF経費は独自のBearer Tokenを使用（OAuth基盤とは別）
const MF_EXPENSE_TOKEN = process.env.MF_EXPENSE_ACCESS_TOKEN || "";

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
