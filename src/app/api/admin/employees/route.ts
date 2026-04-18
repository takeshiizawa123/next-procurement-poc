import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/api-auth";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * 従業員マスタAPI
 *
 * GET /api/admin/employees — 一覧
 * POST /api/admin/employees — payrollCode/employmentType を一括更新
 *  body: { updates: Array<{ slackId: string, payrollCode?: string, employmentType?: string }> }
 */
export async function GET(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const rows = await db.select().from(employees).orderBy(employees.name);
    return NextResponse.json({ ok: true, employees: rows });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const updates = body.updates as Array<{
      slackId: string;
      payrollCode?: string;
      employmentType?: string;
    }>;
    if (!Array.isArray(updates)) {
      return NextResponse.json({ error: "updates array required" }, { status: 400 });
    }

    let updated = 0;
    const errors: string[] = [];
    for (const u of updates) {
      if (!u.slackId) continue;
      try {
        const fields: Record<string, string | null> = {};
        if (u.payrollCode !== undefined) fields.payrollCode = u.payrollCode || null;
        if (u.employmentType !== undefined) fields.employmentType = u.employmentType || null;
        if (Object.keys(fields).length === 0) continue;

        const [res] = await db
          .update(employees)
          .set({ ...fields, updatedAt: new Date() })
          .where(eq(employees.slackId, u.slackId))
          .returning({ slackId: employees.slackId });

        if (res) updated++;
        else errors.push(`${u.slackId}: not found`);
      } catch (e) {
        errors.push(`${u.slackId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return NextResponse.json({
      ok: true,
      updated,
      ...(errors.length > 0 ? { errors } : {}),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
