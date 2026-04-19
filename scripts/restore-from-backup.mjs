/**
 * バックアップJSONからPostgresへリストア
 *
 * 使い方:
 *   ドライラン: node scripts/restore-from-backup.mjs <backup.json>
 *   実行:      node scripts/restore-from-backup.mjs <backup.json> --execute
 *
 * 注意:
 *   - デフォルトはドライラン（差分表示のみ、DB変更なし）
 *   - --execute フラグで実際に TRUNCATE + INSERT 実行
 *   - バックアップは主要5テーブルのみ: employees, purchase_requests,
 *     predicted_transactions, account_corrections, audit_log
 *   - 他のテーブル（contracts等）は別途手動復旧が必要
 */
import postgres from "postgres";
import { readFileSync, existsSync } from "fs";
import { config } from "dotenv";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

config({ path: ".env.local" });

const backupFile = process.argv[2];
const execute = process.argv.includes("--execute");

if (!backupFile || !existsSync(backupFile)) {
  console.error("Usage: node scripts/restore-from-backup.mjs <backup.json> [--execute]");
  console.error("  ドライラン: node scripts/restore-from-backup.mjs db-backup-2026-04-18.json");
  console.error("  実行:      node scripts/restore-from-backup.mjs db-backup-2026-04-18.json --execute");
  process.exit(1);
}

const backup = JSON.parse(readFileSync(backupFile, "utf-8"));

if (!backup.tables || !backup.exportedAt) {
  console.error("❌ 無効なバックアップファイル（tables/exportedAtが欠落）");
  process.exit(1);
}

console.log(`\n=== バックアップファイル情報 ===`);
console.log(`  エクスポート日時: ${backup.exportedAt}`);
console.log(`  バージョン: ${backup.version}`);
console.log(`  総レコード数: ${backup.summary?.totalRecords ?? "不明"}`);
console.log(`\n=== テーブル別件数 ===`);
for (const [table, data] of Object.entries(backup.tables)) {
  console.log(`  ${table}: ${data.count} 件`);
}

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!connectionString) {
  console.error("❌ POSTGRES_URL_NON_POOLING 未設定");
  process.exit(1);
}

const sql = postgres(connectionString, { max: 1 });

try {
  // 現在のDB件数を取得して差分を表示
  console.log(`\n=== 現在のDB件数 ===`);
  for (const tableName of Object.keys(backup.tables)) {
    const [{ count }] = await sql`SELECT count(*)::int as count FROM ${sql(tableName)}`;
    const backupCount = backup.tables[tableName].count;
    const diff = backupCount - count;
    const sign = diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : "±0";
    console.log(`  ${tableName}: 現在 ${count} 件 → 復旧後 ${backupCount} 件 (${sign})`);
  }

  if (!execute) {
    console.log(`\n[DRYRUN] --execute フラグを付けて実行すると復旧が実行されます`);
    console.log(`\n ⚠️ 復旧は以下の処理を行います:`);
    console.log(`  1. 外部キー制約をDEFERRED に`);
    console.log(`  2. 対象テーブルをTRUNCATE（既存データ全削除）`);
    console.log(`  3. バックアップから行を一括INSERT`);
    console.log(`  4. シーケンスを最大IDに再設定`);
    console.log(`  5. トランザクションコミット or ROLLBACK`);
    await sql.end();
    process.exit(0);
  }

  // 本番モード: 最終確認
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(
    `\n⚠️ 本当に復旧を実行しますか? 既存データは全削除されます (yes/no): `,
  );
  rl.close();
  if (answer.trim().toLowerCase() !== "yes") {
    console.log("キャンセルしました");
    await sql.end();
    process.exit(0);
  }

  console.log(`\n復旧実行中...`);
  await sql.begin(async (tx) => {
    await tx`SET CONSTRAINTS ALL DEFERRED`;

    // 外部キー順: employees → purchase_requests → predicted_transactions
    //           → account_corrections → audit_log
    const tableOrder = [
      "employees",
      "purchase_requests",
      "predicted_transactions",
      "account_corrections",
      "audit_log",
    ];

    for (const tableName of tableOrder) {
      const table = backup.tables[tableName];
      if (!table) continue;

      console.log(`  [${tableName}] TRUNCATE + INSERT ${table.count} 件...`);
      await tx`TRUNCATE TABLE ${tx(tableName)} RESTART IDENTITY CASCADE`;

      if (table.rows.length === 0) continue;

      // バッチINSERT（500行ずつ）
      const batchSize = 500;
      for (let i = 0; i < table.rows.length; i += batchSize) {
        const batch = table.rows.slice(i, i + batchSize);
        await tx`INSERT INTO ${tx(tableName)} ${tx(batch)}`;
      }

      // シーケンス再設定（idカラムがある場合）
      const [{ exists }] = await tx`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = ${tableName} AND column_name = 'id'
        ) as exists
      `;
      if (exists) {
        await tx`
          SELECT setval(
            pg_get_serial_sequence(${tableName}, 'id'),
            COALESCE((SELECT MAX(id) FROM ${tx(tableName)}), 1),
            true
          )
        `.catch(() => {
          // シーケンスがないテーブル（例: varchar PK）はスキップ
        });
      }
    }
  });

  console.log(`\n✓ 復旧完了`);
  console.log(`\n次のステップ:`);
  console.log(`  1. アプリが正常動作するか確認`);
  console.log(`  2. /admin/dashboard で件数が期待通りか検証`);
  console.log(`  3. 監査ログに手動復旧の事実を記録`);
} catch (e) {
  console.error(`\n❌ 復旧失敗:`, e.message);
  console.error(`  トランザクションはロールバック済み`);
  process.exit(1);
} finally {
  await sql.end();
}
