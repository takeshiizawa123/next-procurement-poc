import { NextRequest, NextResponse } from "next/server";
import { getSlackClient } from "@/lib/slack";

const DEFAULT_APPROVER = process.env.SLACK_DEFAULT_APPROVER || "";

interface ApprovalStep {
  role: string;
  name: string;
  slackId: string;
}

/**
 * 承認ルートプレビュー
 * GET /api/purchase/approval-route?amount=50000&isPurchased=false
 *
 * 金額に応じた承認ルートを返す
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const amount = Number(searchParams.get("amount") || "0");
  const isPurchased = searchParams.get("isPurchased") === "true";

  // 購入済は承認不要
  if (isPurchased) {
    return NextResponse.json({
      steps: [],
      summary: "購入済のため承認ステップはスキップされます",
      requiresDeptHead: false,
    });
  }

  const steps: ApprovalStep[] = [];
  const isHighValue = amount >= 100000;

  // デフォルト承認者を解決
  if (DEFAULT_APPROVER) {
    let approverName = DEFAULT_APPROVER;
    try {
      const client = getSlackClient();
      const info = await client.users.info({ user: DEFAULT_APPROVER });
      approverName = info.user?.real_name || info.user?.name || DEFAULT_APPROVER;
    } catch {
      // Slack API失敗時はIDのまま
    }
    steps.push({
      role: "承認者",
      name: approverName,
      slackId: DEFAULT_APPROVER,
    });
  }

  // 10万円以上は部門長承認が追加
  if (isHighValue) {
    steps.push({
      role: "部門長",
      name: "（部門長の承認が必要）",
      slackId: "",
    });
  }

  const summary = steps.length === 0
    ? "承認者が設定されていません"
    : isHighValue
      ? `${steps[0].name} + 部門長承認（10万円以上）`
      : steps[0].name;

  return NextResponse.json({
    steps,
    summary,
    requiresDeptHead: isHighValue,
  });
}
