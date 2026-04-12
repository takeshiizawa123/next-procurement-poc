import { config } from "dotenv";
config({ path: ".env.development.local" });
config({ path: ".env.production" });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { purchaseRequests } from "../src/db/schema";

const client = postgres(process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL!, { max: 1, prepare: false });
const db = drizzle(client);

async function main() {
  const rows = await db.select().from(purchaseRequests);
  console.log(`Total records: ${rows.length}`);
  for (const r of rows) {
    console.log({
      poNumber: r.poNumber,
      status: r.status,
      requestType: r.requestType,
      applicantName: r.applicantName,
      itemName: r.itemName.slice(0, 40),
      voucherStatus: r.voucherStatus,
      applicationDate: r.applicationDate?.toISOString(),
      inspectedAt: r.inspectedAt?.toISOString(),
    });
  }
  await client.end();
}

main();
