/**
 * 従業員マスタリポジトリ
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { cachedFetch, sharedCacheDeleteByPrefix } from "../shared-cache";
import {
  type DbResponse,
  type Employee,
  ok,
  ng,
  DB_SHORT_TTL,
} from "./types";

/**
 * 従業員マスタ一覧を取得（3分キャッシュ + リクエスト合体）
 */
export async function getEmployees(): Promise<DbResponse<{ employees: Employee[] }>> {
  return cachedFetch("db:employees", DB_SHORT_TTL, async () => {
    try {
      const rows = await db.select().from(employees).where(eq(employees.isActive, true));
      const list: Employee[] = rows.map((r) => ({
        name: r.name,
        departmentCode: r.departmentCode,
        departmentName: r.departmentName,
        slackAliases: r.slackAliases ?? "",
        slackId: r.slackId,
        deptHeadSlackId: r.deptHeadSlackId ?? "",
      }));
      return ok({ employees: list });
    } catch (e) {
      return ng<{ employees: Employee[] }>(e instanceof Error ? e.message : String(e));
    }
  });
}

/**
 * 従業員の承認者（部門長SlackID）を更新
 */
export async function updateApprover(
  employeeName: string,
  deptHeadSlackId: string,
): Promise<DbResponse<{ updated: boolean }>> {
  try {
    await db
      .update(employees)
      .set({ deptHeadSlackId, updatedAt: new Date() })
      .where(eq(employees.name, employeeName));
    await sharedCacheDeleteByPrefix("db:employees");
    return ok({ updated: true });
  } catch (e) {
    return ng(e instanceof Error ? e.message : String(e));
  }
}
