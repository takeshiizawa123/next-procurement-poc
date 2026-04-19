/**
 * GAS購買管理シート（本番「購買管理」シート）→ Postgres purchase_requests へのデータ移行
 *
 * 使い方:
 *   ドライラン: node scripts/migrate-gas-to-postgres.mjs <input.csv>
 *   実行:      node scripts/migrate-gas-to-postgres.mjs <input.csv> --execute
 *
 * 事前準備:
 *   1. GAS「購買管理」シートをExcel/CSVエクスポート
 *   2. UTF-8 BOMなしCSVに変換（Shift-JISならiconvで変換）
 *   3. 1行目に列名ヘッダーが必要
 *
 * マッピング:
 *   CSV列名 → purchase_requests 列名
 *   ※このスクリプト内の COLUMN_MAP を実際のシート列名に合わせて調整すること
 *
 * UPSERT動作:
 *   po_number をキーとしてON CONFLICT DO UPDATE（既存レコードは更新）
 *
 * 出力:
 *   - 成功件数
 *   - 失敗件数＋失敗理由（別CSVに出力）
 */
import postgres from "postgres";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { config } from "dotenv";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

config({ path: ".env.local" });

const inputFile = process.argv[2];
const execute = process.argv.includes("--execute");

if (!inputFile || !existsSync(inputFile)) {
  console.error("Usage: node scripts/migrate-gas-to-postgres.mjs <input.csv> [--execute]");
  process.exit(1);
}

// CSV列名 → purchase_requests 列名マッピング
// 本番「購買管理」シートの実際の列名に応じて調整（事前確認必須）
const COLUMN_MAP = {
  // 必須
  "申請番号": "po_number", // 例: "PO-2024-0001"
  "申請区分": "request_type", // 購入前/購入済/役務
  "申請者SlackID": "applicant_slack_id",
  "申請者": "applicant_name",
  "部門": "department",
  "品目名": "item_name",
  "数量": "quantity",
  "単価": "unit_price",
  "合計額（税込）": "total_amount",
  "支払方法": "payment_method",
  "申請日": "application_date",
  // 任意（ある場合のみ移行）
  "承認者SlackID": "approver_slack_id",
  "承認者": "approver_name",
  "検収者": "inspector_slack_id",
  "購入先": "supplier_name",
  "購入先URL": "supplier_url",
  "HubSpot案件番号": "hubspot_deal_id",
  "予算番号": "budget_number",
  "KATANA PO番号": "katana_po_number",
  "勘定科目": "account_title",
  "購入理由": "purpose",
  "発注承認ステータス": "approval_status",
  "発注ステータス": "order_status",
  "検収ステータス": "inspection_status",
  "検収日": "inspection_date",
  "証憑対応": "voucher_status",
  "仕訳ID": "matched_journal_id",
  "MF仕訳ID": "matched_journal_id",
  "備考": "remarks",
  "スレッドTS": "slack_ts",
};

// 簡易CSVパーサー（カンマ区切り、ダブルクォートエスケープ対応）
function parseCsv(content) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { field += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === ",") { row.push(field); field = ""; }
        else { field += ch; }
      }
    }
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const csvContent = readFileSync(inputFile, "utf-8").replace(/^\uFEFF/, "");
const rows = parseCsv(csvContent);
if (rows.length < 2) {
  console.error("❌ CSVにデータ行がありません");
  process.exit(1);
}

const header = rows[0];
const dataRows = rows.slice(1);

console.log(`\n=== 入力CSV情報 ===`);
console.log(`  ファイル: ${inputFile}`);
console.log(`  ヘッダー: ${header.join(", ")}`);
console.log(`  データ行数: ${dataRows.length}`);

// マッピング確認
const columnIndices = {};
for (const [csvCol, dbCol] of Object.entries(COLUMN_MAP)) {
  const idx = header.indexOf(csvCol);
  if (idx >= 0) columnIndices[dbCol] = idx;
}

console.log(`\n=== マッピング結果 ===`);
console.log(`  認識された列: ${Object.keys(columnIndices).length} / ${Object.keys(COLUMN_MAP).length}`);
const unmapped = Object.keys(COLUMN_MAP).filter((csvCol) => header.indexOf(csvCol) === -1);
if (unmapped.length > 0) {
  console.log(`  ⚠️ 見つからない列: ${unmapped.join(", ")}`);
}

// 必須列チェック
const requiredDbCols = ["po_number", "applicant_slack_id", "applicant_name", "department", "item_name", "total_amount"];
const missingRequired = requiredDbCols.filter((col) => !(col in columnIndices));
if (missingRequired.length > 0) {
  console.error(`\n❌ 必須列が見つかりません: ${missingRequired.join(", ")}`);
  console.error(`COLUMN_MAP を実際のCSV列名に合わせて調整してください`);
  process.exit(1);
}

// 各行をDBレコードに変換
function buildRecord(row) {
  const rec = {};
  for (const [dbCol, idx] of Object.entries(columnIndices)) {
    const val = (row[idx] || "").trim();
    if (!val) continue;
    // 型変換
    if (["quantity", "unit_price", "total_amount", "matched_journal_id"].includes(dbCol)) {
      const num = parseInt(val.replace(/[,¥]/g, ""), 10);
      if (!isNaN(num)) rec[dbCol] = num;
    } else if (["application_date", "inspection_date"].includes(dbCol)) {
      const d = new Date(val);
      if (!isNaN(d.getTime())) rec[dbCol] = d.toISOString().split("T")[0];
    } else {
      rec[dbCol] = val;
    }
  }
  return rec;
}

// ドライラン検証
const records = [];
const errors = [];
for (let i = 0; i < dataRows.length; i++) {
  const row = dataRows[i];
  try {
    const rec = buildRecord(row);
    if (!rec.po_number) {
      errors.push({ row: i + 2, reason: "po_number 空" });
      continue;
    }
    records.push(rec);
  } catch (e) {
    errors.push({ row: i + 2, reason: e.message });
  }
}

console.log(`\n=== 検証結果 ===`);
console.log(`  変換成功: ${records.length} 件`);
console.log(`  変換失敗: ${errors.length} 件`);
if (errors.length > 0 && errors.length <= 20) {
  for (const e of errors.slice(0, 20)) {
    console.log(`    行${e.row}: ${e.reason}`);
  }
}

if (!execute) {
  console.log(`\n[DRYRUN] --execute フラグを付けて実行するとDBに書き込みます`);
  console.log(`\n ⚠️ 実行時は以下を行います:`);
  console.log(`  1. 各レコードをpurchase_requestsにUPSERT（ON CONFLICT (po_number) DO UPDATE）`);
  console.log(`  2. 既存レコードは更新される`);
  console.log(`  3. 新規レコードは挿入される`);
  console.log(`  4. エラーログを ${inputFile}.errors.csv に出力`);
  process.exit(0);
}

// 実行モード
const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sql = postgres(connectionString, { max: 1 });

const rl = readline.createInterface({ input, output });
const answer = await rl.question(
  `\n⚠️ ${records.length} 件をUPSERTします。続行しますか? (yes/no): `,
);
rl.close();
if (answer.trim().toLowerCase() !== "yes") {
  console.log("キャンセルしました");
  await sql.end();
  process.exit(0);
}

let insertedCount = 0;
let updatedCount = 0;
const execErrors = [];

for (const rec of records) {
  try {
    // 既存確認
    const existing = await sql`SELECT po_number FROM purchase_requests WHERE po_number = ${rec.po_number}`;
    const isExisting = existing.length > 0;

    // INSERT or UPDATE
    if (isExisting) {
      await sql`UPDATE purchase_requests SET ${sql(rec)}, updated_at = NOW() WHERE po_number = ${rec.po_number}`;
      updatedCount++;
    } else {
      await sql`INSERT INTO purchase_requests ${sql(rec)}`;
      insertedCount++;
    }
  } catch (e) {
    execErrors.push({ po_number: rec.po_number, error: e.message });
  }
}

console.log(`\n=== 実行結果 ===`);
console.log(`  新規INSERT: ${insertedCount} 件`);
console.log(`  UPDATE: ${updatedCount} 件`);
console.log(`  失敗: ${execErrors.length} 件`);

if (execErrors.length > 0) {
  const errorCsvPath = `${inputFile}.errors.csv`;
  const errorCsv = "po_number,error\n" +
    execErrors.map((e) => `${e.po_number},"${e.error.replace(/"/g, '""')}"`).join("\n");
  writeFileSync(errorCsvPath, errorCsv, "utf-8");
  console.log(`  エラー詳細: ${errorCsvPath}`);
}

console.log(`\n✓ 移行完了`);
console.log(`\n次のステップ:`);
console.log(`  1. /admin/dashboard で件数確認`);
console.log(`  2. サンプルPO番号でDB内容を検証`);
console.log(`  3. 差分があれば再実行（UPSERTなので安全）`);

await sql.end();
