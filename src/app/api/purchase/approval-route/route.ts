import { NextRequest, NextResponse } from "next/server";
import { getSlackClient } from "@/lib/slack";
import { resolveApprovalRoute } from "@/lib/approval-router";
import { requireApiKey } from "@/lib/api-auth";

interface ApprovalStep {
  role: string;
  name: string;
  slackId: string;
}

async function resolveSlackName(slackId: string): Promise<string> {
  if (!slackId) return "";
  try {
    const client = getSlackClient();
    const info = await client.users.info({ user: slackId });
    return info.user?.real_name || info.user?.name || slackId;
  } catch {
    return slackId;
  }
}

/**
 * 承認ルートプレビュー（APIキー認証）
 * GET /api/purchase/approval-route?amount=50000&isPurchased=false&userId=xxx
 */
export async function GET(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;
  const { searchParams } = new URL(request.url);
  const amount = Number(searchParams.get("amount") || "0");
  const isPurchased = searchParams.get("isPurchased") === "true";
  const userId = searchParams.get("userId") || "";
  const applicantName = searchParams.get("applicantName") || "";

  if (isPurchased) {
    return NextResponse.json({
      steps: [],
      summary: "購入済のため承認ステップはスキップされます",
    });
  }

  const route = await resolveApprovalRoute(applicantName, userId, amount);
  const steps: ApprovalStep[] = [];

  if (route.primaryApprover) {
    const name = await resolveSlackName(route.primaryApprover);
    steps.push({
      role: "部門長",
      name,
      slackId: route.primaryApprover,
    });
  }

  const summary = steps.length === 0
    ? "承認者が設定されていません（従業員マスタに部門長SlackIDを設定してください）"
    : steps.map((s) => s.name).join(" → ");

  return NextResponse.json({
    steps,
    summary,
  });
}
