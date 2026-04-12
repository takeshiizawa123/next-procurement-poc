/**
 * マイグレーションをSupabaseに直接適用するスクリプト
 *
 * drizzle-kit pushはTTY必須なので、生成されたSQLを直接実行する
 */
import { config } from "dotenv";
import postgres from "postgres";
import fs from "fs";
import path from "path";

config({ path: ".env.development.local" });

async function main() {
  const url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!url) {
    console.error("POSTGRES_URL_NON_POOLING or POSTGRES_URL is required");
    process.exit(1);
  }

  const migrationsDir = path.join(process.cwd(), "src/db/migrations");
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.error("No migration files found");
    process.exit(1);
  }

  // 直接接続（PgBouncer非経由）
  const sql = postgres(url, { max: 1, prepare: false });

  try {
    for (const file of files) {
      console.log(`Applying ${file}...`);
      const content = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      // statement-breakpointで分割
      const statements = content.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        try {
          await sql.unsafe(stmt);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("already exists")) {
            console.log(`  [skip] ${msg.slice(0, 80)}`);
            continue;
          }
          throw e;
        }
      }
      console.log(`  ✓ ${file} done`);
    }

    // 確認: テーブル一覧を取得
    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `;
    console.log("\nCreated tables:");
    tables.forEach((t) => console.log(`  - ${t.table_name}`));
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
