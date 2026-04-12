import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  employees,
  purchaseRequests,
  predictedTransactions,
  accountCorrections,
  auditLog,
} from "@/db/schema";
import { desc, sql } from "drizzle-orm";
import { google } from "googleapis";
import { Readable } from "stream";

const CRON_SECRET = process.env.CRON_SECRET || "";
const BACKUP_FOLDER_ID = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID || process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "";
// 0 = 永久保持（削除しない）、正の数 = N日後に自動削除
const BACKUP_RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || "0", 10);

/**
 * 日次DBバックアップ（Google Drive保存）
 * GET /api/cron/db-backup
 *
 * vercel.json: { "path": "/api/cron/db-backup", "schedule": "0 18 * * *" }
 * (UTC 18:00 = JST 03:00 深夜)
 *
 * 主要テーブルをJSON化 → Google Drive「DBバックアップ」フォルダに保存
 * 7日以上古いバックアップは自動削除
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    // --- 1. 主要テーブルのデータ取得 ---
    const [
      employeeRows,
      purchaseRows,
      predictionRows,
      correctionRows,
      recentAuditRows,
    ] = await Promise.all([
      db.select().from(employees),
      db.select().from(purchaseRequests).orderBy(desc(purchaseRequests.applicationDate)),
      db.select().from(predictedTransactions).orderBy(desc(predictedTransactions.createdAt)),
      db.select().from(accountCorrections).orderBy(desc(accountCorrections.createdAt)),
      db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(5000),
    ]);

    const backup = {
      exportedAt: new Date().toISOString(),
      version: "1.0",
      tables: {
        employees: { count: employeeRows.length, rows: employeeRows },
        purchase_requests: { count: purchaseRows.length, rows: purchaseRows },
        predicted_transactions: { count: predictionRows.length, rows: predictionRows },
        account_corrections: { count: correctionRows.length, rows: correctionRows },
        audit_log: { count: recentAuditRows.length, rows: recentAuditRows, note: "直近5000件" },
      },
      summary: {
        totalRecords: employeeRows.length + purchaseRows.length + predictionRows.length + correctionRows.length + recentAuditRows.length,
      },
    };

    const jsonStr = JSON.stringify(backup, null, 2);
    const sizeKB = Math.round(Buffer.byteLength(jsonStr, "utf-8") / 1024);

    // --- 2. Google Driveにアップロード ---
    const drive = getDriveClient();
    if (!drive) {
      return NextResponse.json({
        ok: false,
        error: "Google Drive未設定（GOOGLE_SERVICE_ACCOUNT_KEY）",
        summary: backup.summary,
        sizeKB,
      });
    }

    // バックアップフォルダを取得/作成
    const backupFolderId = await ensureBackupFolder(drive);

    // ファイル名: db-backup-YYYY-MM-DD.json
    const today = new Date().toISOString().slice(0, 10);
    const fileName = `db-backup-${today}.json`;

    // アップロード
    const stream = new Readable();
    stream.push(jsonStr);
    stream.push(null);

    const uploadRes = await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType: "application/json",
        parents: [backupFolderId],
      },
      media: {
        mimeType: "application/json",
        body: stream,
      },
      fields: "id, name, size",
    });

    console.log(`[db-backup] Uploaded: ${fileName} (${sizeKB}KB) → ${uploadRes.data.id}`);

    // --- 3. 古いバックアップを削除 ---
    // 古いバックアップの自動削除（BACKUP_RETENTION_DAYS=0 なら永久保持）
    const deletedCount = BACKUP_RETENTION_DAYS > 0
      ? await cleanupOldBackups(drive, backupFolderId)
      : 0;

    const durationMs = Date.now() - startTime;

    return NextResponse.json({
      ok: true,
      fileName,
      fileId: uploadRes.data.id,
      sizeKB,
      tables: {
        employees: employeeRows.length,
        purchase_requests: purchaseRows.length,
        predicted_transactions: predictionRows.length,
        account_corrections: correctionRows.length,
        audit_log: recentAuditRows.length,
      },
      deletedOldBackups: deletedCount,
      durationMs,
    });
  } catch (error) {
    console.error("[db-backup] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

// --- Google Drive ヘルパー ---

function getDriveClient() {
  const keyBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyBase64) return null;

  try {
    const keyJson = JSON.parse(Buffer.from(keyBase64, "base64").toString("utf-8"));
    const auth = new google.auth.GoogleAuth({
      credentials: keyJson,
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });
    return google.drive({ version: "v3", auth });
  } catch {
    return null;
  }
}

async function ensureBackupFolder(drive: ReturnType<typeof google.drive>): Promise<string> {
  const parentId = BACKUP_FOLDER_ID;

  // 「DBバックアップ」フォルダを検索
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name = 'DBバックアップ' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id)",
    pageSize: 1,
  });

  if (res.data.files?.[0]?.id) {
    return res.data.files[0].id;
  }

  // なければ作成
  const createRes = await drive.files.create({
    requestBody: {
      name: "DBバックアップ",
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });

  return createRes.data.id!;
}

async function cleanupOldBackups(
  drive: ReturnType<typeof google.drive>,
  folderId: string,
): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - BACKUP_RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString();

  const res = await drive.files.list({
    q: `'${folderId}' in parents and name contains 'db-backup-' and createdTime < '${cutoffStr}' and trashed = false`,
    fields: "files(id, name, createdTime)",
    pageSize: 50,
  });

  const oldFiles = res.data.files || [];
  let deleted = 0;

  for (const file of oldFiles) {
    try {
      await drive.files.delete({ fileId: file.id! });
      console.log(`[db-backup] Deleted old backup: ${file.name}`);
      deleted++;
    } catch (e) {
      console.warn(`[db-backup] Failed to delete ${file.name}:`, e);
    }
  }

  return deleted;
}
