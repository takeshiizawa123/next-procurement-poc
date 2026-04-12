import type { Config } from "drizzle-kit";
import { config } from "dotenv";

// .env.development.local から環境変数を読み込み（Vercel env pull で作られる）
config({ path: ".env.development.local" });

/**
 * Drizzle Kit 設定
 *
 * マイグレーションの生成・適用に使用。
 * 環境変数 POSTGRES_URL (Vercel Marketplace Supabase) を使用。
 */
export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || "",
  },
  verbose: true,
  strict: true,
} satisfies Config;
