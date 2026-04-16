/**
 * Supabaseマイグレーション実行スクリプト
 *
 * 使い方: node scripts/run-migrations.mjs <migration_file>
 * 例:   node scripts/run-migrations.mjs supabase/migrations/0006_add_volume_invoice_fields.sql
 *
 * 注意: ALTER TYPE ADD VALUE はトランザクション内で実行できないため、
 *      各ALTER TYPE文は個別に実行される
 */
import postgres from "postgres";
import { readFileSync } from "fs";
import { config } from "dotenv";

// .env.local を読み込み
config({ path: ".env.local" });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!connectionString) {
  console.error("POSTGRES_URL_NON_POOLING or POSTGRES_URL must be set");
  process.exit(1);
}

const migrationFile = process.argv[2];
if (!migrationFile) {
  console.error("Usage: node scripts/run-migrations.mjs <migration_file>");
  process.exit(1);
}

const sql = readFileSync(migrationFile, "utf-8");

// コメント除去 + セミコロンで分割
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

console.log(`[migration] File: ${migrationFile}`);
console.log(`[migration] Statements: ${statements.length}`);

const client = postgres(connectionString, { max: 1 });

try {
  for (const stmt of statements) {
    console.log(`[migration] Executing: ${stmt.slice(0, 80)}${stmt.length > 80 ? "..." : ""}`);
    await client.unsafe(stmt);
    console.log("[migration] ✓ OK");
  }
  console.log("[migration] All statements executed successfully");
} catch (e) {
  console.error("[migration] Failed:", e.message);
  process.exit(1);
} finally {
  await client.end();
}
