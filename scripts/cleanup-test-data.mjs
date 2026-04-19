/**
 * テストデータ削除スクリプト
 *
 * 使い方: node scripts/cleanup-test-data.mjs
 *
 * 削除対象:
 *   - purchase_requests (po_number LIKE '%TEST%')
 *   - contracts (contract_number LIKE 'CT-TEST-%')
 *   - contract_invoices (対応contractのcascade)
 *   - predicted_transactions (id LIKE 'PCT-TEST-%')
 *   - audit_log (record_id が上記に該当するもの)
 */
import postgres from "postgres";
import { config } from "dotenv";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

config({ path: ".env.local" });

const sql = postgres(process.env.POSTGRES_URL_NON_POOLING, { max: 1 });

try {
  // 件数確認
  const [{ pr }] = await sql`SELECT count(*)::int as pr FROM purchase_requests WHERE po_number LIKE '%TEST%'`;
  const [{ ct }] = await sql`SELECT count(*)::int as ct FROM contracts WHERE contract_number LIKE 'CT-TEST-%'`;
  const [{ ci }] = await sql`SELECT count(*)::int as ci FROM contract_invoices WHERE contract_id IN (SELECT id FROM contracts WHERE contract_number LIKE 'CT-TEST-%')`;
  const [{ pt }] = await sql`SELECT count(*)::int as pt FROM predicted_transactions WHERE id LIKE 'PCT-TEST-%'`;

  console.log(`\n=== 削除対象 ===`);
  console.log(`  purchase_requests (TEST): ${pr}件`);
  console.log(`  contracts (CT-TEST-): ${ct}件`);
  console.log(`  contract_invoices (CT-TEST-配下): ${ci}件`);
  console.log(`  predicted_transactions (PCT-TEST-): ${pt}件`);

  const total = pr + ct + ci + pt;
  if (total === 0) {
    console.log(`\n✓ 削除対象なし`);
    process.exit(0);
  }

  // 確認プロンプト
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(`\n合計 ${total} 件を削除しますか? (yes/no): `);
  rl.close();
  if (answer.trim().toLowerCase() !== "yes") {
    console.log("キャンセルしました");
    process.exit(0);
  }

  // 削除（子→親の順）
  await sql`DELETE FROM contract_invoices WHERE contract_id IN (SELECT id FROM contracts WHERE contract_number LIKE 'CT-TEST-%')`;
  await sql`DELETE FROM contracts WHERE contract_number LIKE 'CT-TEST-%'`;
  await sql`DELETE FROM predicted_transactions WHERE id LIKE 'PCT-TEST-%'`;
  await sql`DELETE FROM audit_log WHERE record_id LIKE '%TEST%'`;
  await sql`DELETE FROM purchase_requests WHERE po_number LIKE '%TEST%'`;

  console.log(`\n✓ 削除完了`);
} catch (e) {
  console.error(`\n❌ 削除失敗:`, e.message);
  process.exit(1);
} finally {
  await sql.end();
}
