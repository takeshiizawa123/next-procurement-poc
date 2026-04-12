import { NextRequest, NextResponse } from "next/server";
import { getRecentRequests } from "@/lib/gas-client";
import { requireApiKey } from "@/lib/api-auth";

/**
 * 過去申請一覧（APIキー認証）
 * GET /api/purchase/recent?applicant=xxx&limit=20
 */
export async function GET(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;
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
    const res = NextResponse.json(result.data);
    // 申請一覧は更新頻度が高い → CDN 1分 + stale 5分
    res.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return res;
  } catch {
    return NextResponse.json({ requests: [] });
  }
}
