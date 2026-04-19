/**
 * テストデータ投入スクリプト
 *
 * 使い方: node scripts/seed-test-data.mjs [--clean]
 *   --clean: 投入前に既存テストデータ（TEST-プレフィックス）を削除
 *
 * 投入内容:
 *   - purchase_requests: 各ステータスのサンプル 8件
 *   - contracts: 3種類のbilling_type サンプル 3件
 *   - contract_invoices: 契約請求書サンプル
 *   - predicted_transactions: カード予測 2件
 *
 * 既存従業員マスタを使用（作成なし）。
 */
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local" });

const sql = postgres(process.env.POSTGRES_URL_NON_POOLING, { max: 1 });
const clean = process.argv.includes("--clean");

// テスト対象の従業員（実在データから流用、Slack IDは本番のもの）
// テスト用に使うメンバー
const APPLICANT = { slackId: "U04FBAX6MEK", name: "伊澤 剛志" }; // 申請者（自分）
const APPROVER = { slackId: "U1D6HHGTG", name: "金田 卓士" }; // 承認者（部門長役）
const INSPECTOR = { slackId: "U04FBAX6MEK", name: "伊澤 剛志" }; // 検収者（=申請者でテスト簡素化）

const NOW = new Date();
const THIS_MONTH = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, "0")}`;
const TODAY = NOW.toISOString().split("T")[0];
const YESTERDAY = new Date(Date.now() - 86400000).toISOString().split("T")[0];
const FIVE_DAYS_AGO = new Date(Date.now() - 5 * 86400000).toISOString().split("T")[0];

try {
  if (clean) {
    console.log("[seed] Cleaning existing test data...");
    await sql`DELETE FROM contract_invoices WHERE contract_id IN (SELECT id FROM contracts WHERE contract_number LIKE 'CT-TEST-%')`;
    await sql`DELETE FROM contracts WHERE contract_number LIKE 'CT-TEST-%'`;
    await sql`DELETE FROM predicted_transactions WHERE id LIKE 'PCT-TEST-%'`;
    await sql`DELETE FROM purchase_requests WHERE po_number LIKE '%TEST%'`;
    console.log("  ✓ Cleaned");
  }

  // ==========================================
  // 1. 購買申請（物品・役務・出張・立替）
  // ==========================================
  console.log("\n[seed] Inserting purchase_requests...");

  const purchaseRequests = [
    // S01: 申請済み（承認待ち）
    {
      po_number: "PR-TEST-01",
      status: "申請済",
      request_type: "購入前",
      applicant_slack_id: APPLICANT.slackId,
      applicant_name: APPLICANT.name,
      department: "管理本部",
      approver_slack_id: APPROVER.slackId,
      approver_name: APPROVER.name,
      inspector_slack_id: INSPECTOR.slackId,
      inspector_name: INSPECTOR.name,
      item_name: "ノートPC（テスト）",
      unit_price: 150000,
      quantity: 1,
      total_amount: 150000,
      payment_method: "会社カード",
      purpose: "テスト用の申請済みサンプル",
      supplier_name: "Amazon",
      application_date: TODAY,
      voucher_status: "none",
    },
    // S02: 承認済み・発注待ち
    {
      po_number: "PR-TEST-02",
      status: "承認済",
      request_type: "購入前",
      applicant_slack_id: APPLICANT.slackId,
      applicant_name: APPLICANT.name,
      department: "管理本部",
      approver_slack_id: APPROVER.slackId,
      approver_name: APPROVER.name,
      inspector_slack_id: INSPECTOR.slackId,
      inspector_name: INSPECTOR.name,
      item_name: "モニター（テスト）",
      unit_price: 35000,
      quantity: 2,
      total_amount: 70000,
      payment_method: "会社カード",
      purpose: "承認済みサンプル",
      supplier_name: "モノタロウ",
      application_date: YESTERDAY,
      approved_at: new Date(),
      voucher_status: "none",
    },
    // S03: 発注済・検収待ち
    {
      po_number: "PR-TEST-03",
      status: "発注済",
      request_type: "購入前",
      applicant_slack_id: APPLICANT.slackId,
      applicant_name: APPLICANT.name,
      department: "管理本部",
      approver_slack_id: APPROVER.slackId,
      approver_name: APPROVER.name,
      inspector_slack_id: INSPECTOR.slackId,
      inspector_name: INSPECTOR.name,
      item_name: "USBケーブル（テスト）",
      unit_price: 1500,
      quantity: 10,
      total_amount: 15000,
      payment_method: "会社カード",
      purpose: "発注済みサンプル",
      supplier_name: "ASKUL",
      application_date: YESTERDAY,
      approved_at: new Date(),
      ordered_at: new Date(),
      voucher_status: "none",
    },
    // S04: 検収済・証憑待ち
    {
      po_number: "PR-TEST-04",
      status: "検収済",
      request_type: "購入前",
      applicant_slack_id: APPLICANT.slackId,
      applicant_name: APPLICANT.name,
      department: "管理本部",
      approver_slack_id: APPROVER.slackId,
      approver_name: APPROVER.name,
      inspector_slack_id: INSPECTOR.slackId,
      inspector_name: INSPECTOR.name,
      item_name: "A4用紙500枚（テスト）",
      unit_price: 800,
      quantity: 3,
      total_amount: 2400,
      payment_method: "会社カード",
      purpose: "検収済みで証憑待ちのサンプル",
      supplier_name: "ASKUL",
      application_date: FIVE_DAYS_AGO,
      approved_at: new Date(),
      ordered_at: new Date(),
      inspected_at: new Date(),
      voucher_status: "none",
    },
    // S05: 役務申請
    {
      po_number: "PR-TEST-05",
      status: "発注済",
      request_type: "役務",
      applicant_slack_id: APPLICANT.slackId,
      applicant_name: APPLICANT.name,
      department: "管理本部",
      approver_slack_id: APPROVER.slackId,
      approver_name: APPROVER.name,
      inspector_slack_id: INSPECTOR.slackId,
      inspector_name: INSPECTOR.name,
      item_name: "スポットコンサル（テスト）",
      unit_price: 300000,
      quantity: 1,
      total_amount: 300000,
      payment_method: "請求書払い",
      purpose: "役務申請のサンプル - 承認済み状態",
      supplier_name: "株式会社テストコンサル",
      application_date: YESTERDAY,
      approved_at: new Date(),
      ordered_at: new Date(),
      voucher_status: "none",
    },
    // S06: 立替精算
    {
      po_number: "PR-TEST-EXP-01",
      status: "検収済",
      request_type: "購入済",
      applicant_slack_id: APPLICANT.slackId,
      applicant_name: APPLICANT.name,
      department: "管理本部",
      approver_slack_id: APPROVER.slackId,
      approver_name: APPROVER.name,
      inspector_slack_id: INSPECTOR.slackId,
      inspector_name: INSPECTOR.name,
      item_name: "会議用お茶・菓子（テスト）",
      unit_price: 3200,
      quantity: 1,
      total_amount: 3200,
      payment_method: "立替",
      purpose: "立替精算のサンプル",
      supplier_name: "コンビニ",
      application_date: FIVE_DAYS_AGO,
      approved_at: new Date(),
      ordered_at: new Date(),
      inspected_at: new Date(),
      voucher_status: "uploaded",
    },
    // S07: 出張申請（日当あり）
    {
      po_number: "TRIP-TEST-01",
      status: "申請済",
      request_type: "購入前",
      applicant_slack_id: APPLICANT.slackId,
      applicant_name: APPLICANT.name,
      department: "管理本部",
      approver_slack_id: APPROVER.slackId,
      approver_name: APPROVER.name,
      inspector_slack_id: INSPECTOR.slackId,
      inspector_name: INSPECTOR.name,
      item_name: "出張: 大阪 (2026-05-01 〜 2026-05-02)",
      unit_price: 25000,
      quantity: 1,
      total_amount: 25000,
      trip_allowance: 6000,
      payment_method: "会社カード",
      purpose: "クライアント訪問のサンプル",
      supplier_name: "新幹線 + ビジネスホテル",
      application_date: TODAY,
      voucher_status: "none",
      remarks: "日当: ¥6,000 / 合計見込: ¥31,000",
    },
    // S08: 差戻し
    {
      po_number: "PR-TEST-REJ",
      status: "差戻し",
      request_type: "購入前",
      applicant_slack_id: APPLICANT.slackId,
      applicant_name: APPLICANT.name,
      department: "管理本部",
      approver_slack_id: APPROVER.slackId,
      approver_name: APPROVER.name,
      inspector_slack_id: INSPECTOR.slackId,
      inspector_name: INSPECTOR.name,
      item_name: "高額品目（テスト）",
      unit_price: 500000,
      quantity: 1,
      total_amount: 500000,
      payment_method: "請求書払い",
      purpose: "差戻しされたサンプル",
      supplier_name: "テスト業者",
      application_date: FIVE_DAYS_AGO,
      voucher_status: "none",
      remarks: "金額が予算超過のため差戻し - 要再申請",
    },
  ];

  for (const pr of purchaseRequests) {
    // 既存を削除してINSERT（シード用途のため簡素化）
    await sql`DELETE FROM purchase_requests WHERE po_number = ${pr.po_number}`;
    await sql`INSERT INTO purchase_requests ${sql(pr)}`;
    console.log(`  ✓ ${pr.po_number} — ${pr.item_name.slice(0, 30)}`);
  }

  // ==========================================
  // 2. 継続契約マスタ（3種類のbilling_type）
  // ==========================================
  console.log("\n[seed] Inserting contracts...");

  const contracts = [
    {
      contract_number: "CT-TEST-0001",
      category: "SaaS",
      billing_type: "固定",
      supplier_name: "株式会社テストSaaS",
      monthly_amount: 50000,
      annual_amount: 600000,
      contract_start_date: "2026-04-01",
      contract_end_date: "2027-03-31",
      renewal_type: "自動更新",
      account_title: "支払手数料",
      department: "管理本部",
      requester_slack_id: APPLICANT.slackId,
      approver_slack_id: APPROVER.slackId,
      auto_approve: true,
      notes: "テスト用: 固定月額SaaS。請求書到着→定額一致で自動承認",
    },
    {
      contract_number: "CT-TEST-0002",
      category: "派遣",
      billing_type: "従量",
      supplier_name: "株式会社テスト派遣",
      budget_amount: 500000,
      contract_start_date: "2026-04-01",
      contract_end_date: "2026-09-30",
      renewal_type: "都度更新",
      account_title: "派遣料",
      department: "技術本部",
      requester_slack_id: APPLICANT.slackId,
      approver_slack_id: APPROVER.slackId,
      notes: "テスト用: 従量派遣。タイムシート+作業報告書を月次提出",
    },
    {
      contract_number: "CT-TEST-0003",
      category: "SaaS",
      billing_type: "カード自動",
      supplier_name: "AWS (テスト)",
      budget_amount: 100000,
      contract_start_date: "2026-01-01",
      renewal_type: "自動更新",
      account_title: "通信費",
      department: "技術本部",
      requester_slack_id: APPLICANT.slackId,
      approver_slack_id: APPROVER.slackId,
      notes: "テスト用: カード自動引落。card-matcher-v2で自動マッチ",
    },
  ];

  const insertedContracts = [];
  for (const c of contracts) {
    await sql`DELETE FROM contracts WHERE contract_number = ${c.contract_number}`;
    const [result] = await sql`INSERT INTO contracts ${sql(c)} RETURNING id, contract_number`;
    insertedContracts.push(result);
    console.log(`  ✓ ${c.contract_number} — ${c.supplier_name} (${c.billing_type})`);
  }

  // ==========================================
  // 3. 契約請求書
  // ==========================================
  console.log("\n[seed] Inserting contract_invoices...");

  const fixed = insertedContracts.find((c) => c.contract_number === "CT-TEST-0001");
  const volume = insertedContracts.find((c) => c.contract_number === "CT-TEST-0002");

  if (fixed) {
    const fixedInv = {
      contract_id: fixed.id,
      billing_month: THIS_MONTH,
      invoice_amount: 50000,
      expected_amount: 50000,
      amount_diff: 0,
      status: "承認済",
    };
    await sql`DELETE FROM contract_invoices WHERE contract_id = ${fixed.id} AND billing_month = ${THIS_MONTH}`;
    await sql`INSERT INTO contract_invoices ${sql(fixedInv)}`;
    console.log(`  ✓ CT-TEST-0001 ${THIS_MONTH} — 承認済（仕訳登録可）`);
  }

  if (volume) {
    const volumeInv = {
      contract_id: volume.id,
      billing_month: THIS_MONTH,
      invoice_amount: 380000,
      expected_amount: null,
      amount_diff: null,
      status: "受領済",
      hours: "160",
      units: "20",
      report_notes: "テスト: 派遣作業報告書サンプル",
    };
    await sql`DELETE FROM contract_invoices WHERE contract_id = ${volume.id} AND billing_month = ${THIS_MONTH}`;
    await sql`INSERT INTO contract_invoices ${sql(volumeInv)}`;
    console.log(`  ✓ CT-TEST-0002 ${THIS_MONTH} — 受領済（承認待ち）`);
  }

  console.log("\n✅ テストデータ投入完了");
  console.log(`\n=== 投入サマリ ===`);
  console.log(`  購買申請: 8件（各状態のサンプル）`);
  console.log(`  継続契約: 3件（固定/従量/カード自動）`);
  console.log(`  契約請求書: 2件（当月 ${THIS_MONTH}）`);
  console.log(`\n  申請者: ${APPLICANT.name} (${APPLICANT.slackId})`);
  console.log(`  承認者: ${APPROVER.name} (${APPROVER.slackId})`);
  console.log(`\n次のステップ: docs/test-scenarios.md を参照してシナリオ実行`);
} catch (e) {
  console.error("\n❌ シード失敗:", e.message);
  process.exit(1);
} finally {
  await sql.end();
}
