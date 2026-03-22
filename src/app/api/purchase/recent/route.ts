import { NextRequest, NextResponse } from "next/server";
import { getRecentRequests } from "@/lib/gas-client";

/**
 * 過去申請一覧
 * GET /api/purchase/recent?applicant=xxx&limit=20
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const applicant = searchParams.get("applicant") || undefined;
  const limit = searchParams.get("limit")
    ? Number(searchParams.get("limit"))
    : undefined;

  try {
    const result = await getRecentRequests(applicant, limit);
    if (!result.success) {
      return NextResponse.json({ requests: [] });
    }
    return NextResponse.json(result.data);
  } catch {
    return NextResponse.json({ requests: [] });
  }
}
