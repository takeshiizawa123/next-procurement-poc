/**
 * MF経費 office_members → employees.mf_office_member_id 同期スクリプト
 *
 * MF経費APIから全従業員を取得し、名前でマッチングしてDBに mf_office_member_id を保存する。
 *
 * 使い方:
 *   npx tsx scripts/sync-office-members.ts [--dry-run]
 */

import { config } from "dotenv";
config({ path: ".env.production" });
config({ path: ".env.development.local" });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, isNull, or } from "drizzle-orm";
import { employees } from "../src/db/schema";

const DRY_RUN = process.argv.includes("--dry-run");

const MF_EXPENSE_BASE = "https://expense.moneyforward.com/api/external/v1";
const MF_EXPENSE_OFFICE_ID = (process.env.MF_EXPENSE_OFFICE_ID || "").trim();
const MF_EXPENSE_TOKEN = (process.env.MF_EXPENSE_ACCESS_TOKEN || "").trim();

if (!MF_EXPENSE_OFFICE_ID || !MF_EXPENSE_TOKEN) {
  console.error("MF_EXPENSE_OFFICE_ID / MF_EXPENSE_ACCESS_TOKEN が未設定");
  process.exit(1);
}

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!connectionString) {
  console.error("POSTGRES_URL is required");
  process.exit(1);
}

const client = postgres(connectionString, { max: 1, prepare: false });
const db = drizzle(client);

interface OfficeMember {
  id: string;
  name: string;
  identification_code: string;
  number: string;
  is_ex_user: boolean;
  is_ex_authorizer: boolean;
  is_ex_administrator: boolean;
  ex_activated_at: string;
}

/** 名前の正規化: 全角半角スペースを統一し、trim */
function normalizeName(name: string): string {
  return name.replace(/[\u3000\s]+/g, " ").trim();
}

async function fetchOfficeMembers(): Promise<OfficeMember[]> {
  const url = `${MF_EXPENSE_BASE}/offices/${MF_EXPENSE_OFFICE_ID}/office_members`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${MF_EXPENSE_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`MF Expense API error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  // APIレスポンスは配列 or { office_members: [...] } の可能性
  const list = Array.isArray(data) ? data : data.office_members ?? data.data ?? [];
  return list as OfficeMember[];
}

async function main() {
  console.log("=".repeat(60));
  console.log(DRY_RUN ? "[DRY RUN] MF経費 office_members → DB 同期" : "MF経費 office_members → DB 同期");
  console.log("=".repeat(60));

  // 1. MF経費から全メンバー取得
  console.log("\n▶ MF経費 office_members 取得中...");
  const members = await fetchOfficeMembers();
  console.log(`  ✓ ${members.length}名取得`);

  // 2. DB側の全従業員取得
  console.log("\n▶ DB employees 取得中...");
  const dbEmployees = await db.select().from(employees);
  console.log(`  ✓ ${dbEmployees.length}名`);

  // 3. 名前で突合
  console.log("\n▶ 名前マッチング...");
  let matched = 0;
  let alreadySet = 0;
  let notFound = 0;
  const unmatched: string[] = [];
  const updates: { dbId: number; name: string; mfId: string }[] = [];

  for (const emp of dbEmployees) {
    const dbName = normalizeName(emp.name);
    const mfMember = members.find((m) => normalizeName(m.name) === dbName);

    if (!mfMember) {
      notFound++;
      unmatched.push(emp.name);
      continue;
    }

    if (emp.mfOfficeMemberId === mfMember.id) {
      alreadySet++;
      continue;
    }

    updates.push({ dbId: emp.id, name: emp.name, mfId: mfMember.id });
    matched++;
  }

  console.log(`  マッチ: ${matched}, 既に設定済み: ${alreadySet}, 未マッチ: ${notFound}`);

  if (unmatched.length > 0) {
    console.log(`\n⚠️  MF経費に存在しない従業員:`);
    unmatched.forEach((n) => console.log(`    - ${n}`));
  }

  // 4. 更新
  if (updates.length > 0) {
    if (DRY_RUN) {
      console.log(`\n[dry-run] 以下を更新予定:`);
      updates.forEach((u) => console.log(`  ${u.name} → ${u.mfId}`));
    } else {
      console.log(`\n▶ DB更新中...`);
      for (const u of updates) {
        await db
          .update(employees)
          .set({ mfOfficeMemberId: u.mfId, updatedAt: new Date() })
          .where(eq(employees.id, u.dbId));
      }
      console.log(`  ✓ ${updates.length}名を更新`);
    }
  }

  // 5. MF経費側にあるがDBにない従業員
  console.log("\n▶ MF経費にのみ存在する従業員:");
  const dbNames = new Set(dbEmployees.map((e) => normalizeName(e.name)));
  const mfOnly = members.filter((m) => !dbNames.has(normalizeName(m.name)));
  if (mfOnly.length === 0) {
    console.log("  （なし）");
  } else {
    mfOnly.forEach((m) => console.log(`  - ${m.name} (id: ${m.id}, number: ${m.number})`));
  }

  console.log("\n" + "=".repeat(60));
  console.log("同期完了");
  console.log("=".repeat(60));

  await client.end();
}

main().catch((e) => {
  console.error("\n[ERROR]", e);
  client.end();
  process.exit(1);
});
