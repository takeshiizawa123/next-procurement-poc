/**
 * 既存出張レコードの trip_allowance をバックフィル
 * purchase_requests.remarks から "日当: ¥XXX" をパースして trip_allowance に投入
 */
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local" });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sql = postgres(connectionString, { max: 1 });

try {
  const trips = await sql`
    SELECT po_number, remarks
    FROM purchase_requests
    WHERE po_number LIKE 'TRIP-%' AND trip_allowance IS NULL
  `;
  console.log(`[backfill] Found ${trips.length} trip records to backfill`);

  let updated = 0;
  for (const t of trips) {
    if (!t.remarks) continue;
    // 「日当: ¥6,000」形式を抽出
    const m = t.remarks.match(/日当:\s*¥([\d,]+)/);
    if (!m) continue;
    const amount = parseInt(m[1].replace(/,/g, ""), 10);
    if (isNaN(amount) || amount === 0) continue;
    await sql`UPDATE purchase_requests SET trip_allowance = ${amount} WHERE po_number = ${t.po_number}`;
    updated++;
    console.log(`  ${t.po_number}: ¥${amount}`);
  }
  console.log(`[backfill] Updated ${updated} records`);
} catch (e) {
  console.error("[backfill] Failed:", e.message);
  process.exit(1);
} finally {
  await sql.end();
}
