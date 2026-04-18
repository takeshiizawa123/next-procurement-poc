import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/api-auth";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { and, eq, desc, gte, lte } from "drizzle-orm";

/**
 * 監査ログ検索API
 * GET /api/admin/audit-log?recordId=PR-xxx&tableName=purchase_requests&from=YYYY-MM-DD&to=YYYY-MM-DD&limit=100
 */
export async function GET(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const params = request.nextUrl.searchParams;
    const recordId = params.get("recordId");
    const tableName = params.get("tableName");
    const changedBy = params.get("changedBy");
    const from = params.get("from");
    const to = params.get("to");
    const limit = Math.min(parseInt(params.get("limit") || "100", 10), 500);

    const conditions = [];
    if (recordId) conditions.push(eq(auditLog.recordId, recordId));
    if (tableName) conditions.push(eq(auditLog.tableName, tableName));
    if (changedBy) conditions.push(eq(auditLog.changedBy, changedBy));
    if (from) conditions.push(gte(auditLog.createdAt, new Date(from)));
    if (to) conditions.push(lte(auditLog.createdAt, new Date(`${to}T23:59:59Z`)));

    const query = db.select().from(auditLog);
    const filtered = conditions.length > 0 ? query.where(and(...conditions)) : query;
    const entries = await filtered.orderBy(desc(auditLog.createdAt)).limit(limit);

    return NextResponse.json({ ok: true, entries, count: entries.length });
  } catch (e) {
    console.error("[audit-log] GET error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
