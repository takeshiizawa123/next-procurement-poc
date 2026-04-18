import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/api-auth";
import { db } from "@/db";
import { deadLetterQueue } from "@/db/schema";
import { eq } from "drizzle-orm";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * DLQタスクを解決済みマーク
 * PATCH /api/admin/dlq/[id]
 * body: { resolved: true }
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const taskId = parseInt(id, 10);
    if (isNaN(taskId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const resolved = body.resolved === true;

    const [updated] = await db
      .update(deadLetterQueue)
      .set({ resolvedAt: resolved ? new Date() : null })
      .where(eq(deadLetterQueue.id, taskId))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, task: updated });
  } catch (e) {
    console.error("[dlq/id] PATCH error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

/**
 * DLQタスクを削除
 * DELETE /api/admin/dlq/[id]
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const taskId = parseInt(id, 10);
    if (isNaN(taskId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    await db.delete(deadLetterQueue).where(eq(deadLetterQueue.id, taskId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[dlq/id] DELETE error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
