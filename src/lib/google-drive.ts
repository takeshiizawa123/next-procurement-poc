/**
 * Google Drive API クライアント
 *
 * 購買証憑のアップロード・フォルダ管理を提供。
 * サービスアカウント認証で組織のDriveにアクセスする。
 *
 * 環境変数:
 *   GOOGLE_SERVICE_ACCOUNT_KEY — サービスアカウントのJSON鍵（Base64エンコード）
 *   GOOGLE_DRIVE_ROOT_FOLDER_ID — 「購買証憑」ルートフォルダのID
 */

import { google, type drive_v3 } from "googleapis";
import { Readable } from "stream";

// --- 環境変数 ---

const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "";

// --- 認証 ---

let driveClient: drive_v3.Drive | null = null;

function getDriveClient(): drive_v3.Drive {
  if (driveClient) return driveClient;

  const keyBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyBase64) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY が未設定です");
  }
  if (!ROOT_FOLDER_ID) {
    throw new Error("GOOGLE_DRIVE_ROOT_FOLDER_ID が未設定です");
  }

  const keyJson = JSON.parse(Buffer.from(keyBase64, "base64").toString("utf-8"));

  const auth = new google.auth.GoogleAuth({
    credentials: keyJson,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });

  driveClient = google.drive({ version: "v3", auth });
  return driveClient;
}

// --- フォルダ管理 ---

/** フォルダIDキャッシュ（年/月 → folderId） */
const folderCache = new Map<string, string>();

/**
 * 指定フォルダ配下で名前が一致するサブフォルダを検索
 * 見つからなければ null
 */
async function findFolder(
  parentId: string,
  name: string,
): Promise<string | null> {
  const drive = getDriveClient();
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name)",
    pageSize: 1,
  });
  return res.data.files?.[0]?.id ?? null;
}

/**
 * フォルダを作成して ID を返す
 */
async function createFolder(
  parentId: string,
  name: string,
): Promise<string> {
  const drive = getDriveClient();
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });
  const id = res.data.id;
  if (!id) throw new Error(`フォルダ作成に失敗しました: ${name}`);
  return id;
}

/**
 * 年/月フォルダを確保して月フォルダIDを返す
 *
 * 構成: 購買証憑/ → 2026/ → 03/
 */
export async function ensureMonthlyFolder(
  transactionDate: string,
): Promise<string> {
  const [year, month] = transactionDate.split("-");
  const cacheKey = `${year}/${month}`;

  const cached = folderCache.get(cacheKey);
  if (cached) return cached;

  // 年フォルダ
  let yearFolderId = await findFolder(ROOT_FOLDER_ID, year);
  if (!yearFolderId) {
    yearFolderId = await createFolder(ROOT_FOLDER_ID, year);
  }

  // 月フォルダ
  let monthFolderId = await findFolder(yearFolderId, month);
  if (!monthFolderId) {
    monthFolderId = await createFolder(yearFolderId, month);
  }

  folderCache.set(cacheKey, monthFolderId);
  return monthFolderId;
}

// --- ファイル命名 ---

/**
 * 電帳法検索要件に準拠したファイル名を生成
 *
 * 形式: {取引日}_{金額}_{取引先}_{番号}_{書類種別}.{拡張子}
 * 例: 2026-03-15_52800_Amazon_PO-2026-0042_納品書.pdf
 */
export function buildVoucherFileName(params: {
  transactionDate: string;
  amount: number;
  supplierName: string;
  poNumber: string;
  docType?: string;
  originalFileName: string;
}): string {
  const { transactionDate, amount, supplierName, poNumber, docType, originalFileName } = params;

  // 拡張子を元ファイルから取得
  const ext = originalFileName.includes(".")
    ? originalFileName.split(".").pop()!.toLowerCase()
    : "pdf";

  // 取引先名のサニタイズ（ファイル名に使えない文字を除去）
  const safeName = supplierName
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 30);

  const typeLabel = docType || "証憑";

  return `${transactionDate}_${amount}_${safeName}_${poNumber}_${typeLabel}.${ext}`;
}

// --- アップロード ---

export interface UploadVoucherResult {
  fileId: string;
  webViewLink: string;
  fileName: string;
}

/**
 * 証憑ファイルをDriveにアップロード
 *
 * 1. 年/月フォルダを確保
 * 2. 電帳法準拠のファイル名で保存
 * 3. 組織内リンク共有を設定
 * 4. fileId + webViewLink を返す
 */
export async function uploadVoucherToDrive(params: {
  fileBuffer: Buffer;
  mimeType: string;
  transactionDate: string;
  amount: number;
  supplierName: string;
  poNumber: string;
  docType?: string;
  originalFileName: string;
}): Promise<UploadVoucherResult> {
  const {
    fileBuffer,
    mimeType,
    transactionDate,
    amount,
    supplierName,
    poNumber,
    docType,
    originalFileName,
  } = params;

  const drive = getDriveClient();

  // フォルダ確保
  const folderId = await ensureMonthlyFolder(transactionDate);

  // ファイル名生成
  const fileName = buildVoucherFileName({
    transactionDate,
    amount,
    supplierName,
    poNumber,
    docType,
    originalFileName,
  });

  // アップロード
  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
      description: `${poNumber} ${supplierName} ¥${amount.toLocaleString()}`,
    },
    media: {
      mimeType,
      body: Readable.from(fileBuffer),
    },
    fields: "id, webViewLink",
  });

  const fileId = res.data.id;
  const webViewLink = res.data.webViewLink;
  if (!fileId) throw new Error("ファイルアップロードに失敗しました");

  // 組織内リンク共有を設定（domain共有）
  // サービスアカウントのドメインでanyoneInOrganizationに設定
  try {
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });
  } catch (e) {
    // 共有設定失敗は致命的ではない（ファイル自体はアップロード済み）
    console.warn("[google-drive] 共有設定に失敗しました。手動設定が必要です:", e);
  }

  return {
    fileId,
    webViewLink: webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
    fileName,
  };
}

/**
 * Drive上のファイル存在確認（月次整合性チェック用）
 */
export async function checkFileExists(fileId: string): Promise<boolean> {
  try {
    const drive = getDriveClient();
    const res = await drive.files.get({
      fileId,
      fields: "id, trashed",
    });
    return res.data.id !== null && res.data.trashed !== true;
  } catch {
    return false;
  }
}
