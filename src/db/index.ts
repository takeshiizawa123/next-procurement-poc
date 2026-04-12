/**
 * Drizzle ORM Database Client
 *
 * Supabase (Vercel Marketplace) の Postgres に接続する。
 * - POSTGRES_URL: PgBouncer経由（クエリ用、推奨）
 * - POSTGRES_URL_NON_POOLING: 直接接続（マイグレーション・トランザクション用）
 *
 * Vercel serverlessでの注意:
 * - 通常のクエリは POSTGRES_URL (pooled) を使う
 * - マイグレーションは POSTGRES_URL_NON_POOLING を使う
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.POSTGRES_URL || "";

if (!connectionString && process.env.NODE_ENV !== "test") {
  console.warn("[db] POSTGRES_URL is not set. Database operations will fail.");
}

// PgBouncer経由のクライアント（通常クエリ用）
// prepare: false は PgBouncer transaction mode との互換性のため必須
const client = connectionString
  ? postgres(connectionString, {
      prepare: false,
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    })
  : // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({} as any);

export const db = drizzle(client, { schema });

export type Database = typeof db;
