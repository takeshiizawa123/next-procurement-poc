import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/api-auth";
import { db } from "@/db";
import { deadLetterQueue } from "@/db/schema";
import { eq, desc, isNull, and } from "drizzle-orm";

/**
 * DLQ管理API
 *
 * GET  /api/admin/dlq?resolved=false — 失敗タスク一覧
 * POST /api/admin/dlq/{id}/resolve — 解決済みマーク（別途ルート）
 */
export async function GET(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const showResolved = request.nextUrl.searchParams.get("resolved") === "true";
    const taskType = request.nextUrl.searchParams.get("taskType");

    const conditions = [];
    if (!showResolved) conditions.push(isNull(deadLetterQueue.resolvedAt));
    if (taskType) conditions.push(eq(deadLetterQueue.taskType, taskType));

    const query = db.select().from(deadLetterQueue);
    const filtered = conditions.length > 0 ? query.where(and(...conditions)) : query;
    const tasks = await filtered.orderBy(desc(deadLetterQueue.createdAt)).limit(200);

    return NextResponse.json({ ok: true, tasks, count: tasks.length });
  } catch (e) {
    console.error("[dlq] GET error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
