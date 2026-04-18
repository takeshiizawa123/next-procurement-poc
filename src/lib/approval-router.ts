import { getEmployees, type Employee } from "./gas-client";

const DEFAULT_APPROVER = process.env.SLACK_DEFAULT_APPROVER || "";
const ADMIN_APPROVER = process.env.SLACK_ADMIN_APPROVER || "";
// 代替承認者（部門長不在時）: カンマ区切りで複数指定可。全員に同時通知して最初に押した人が承認
const ALTERNATE_APPROVERS = (process.env.SLACK_ALTERNATE_APPROVERS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export interface ApprovalRoute {
  /** 承認者（部門長）の SlackID */
  primaryApprover: string;
  /** 代替承認者（部門長不在時に承認可能なメンバー）。primaryを含まない */
  alternateApprovers: string[];
  /** マッチした従業員情報 */
  employee: Employee | null;
}

/**
 * 申請者名・Slack ID から承認ルートを決定
 *
 * 1. 従業員マスタから申請者を検索 → 部門長SlackIDを取得
 * 2. 見つからなければ DEFAULT_APPROVER にフォールバック
 * 承認は部門長の一段階のみ（二段階承認は廃止）
 */
export async function resolveApprovalRoute(
  applicantName: string,
  applicantSlackId: string,
  totalAmount: number,
): Promise<ApprovalRoute> {
  let primaryApprover = DEFAULT_APPROVER;
  let employee: Employee | null = null;

  try {
    const result = await getEmployees();
    if (result.success && result.data?.employees) {
      const employees = result.data.employees;

      // SlackID で完全一致検索
      if (applicantSlackId) {
        employee = employees.find((e) => e.slackId === applicantSlackId) || null;
      }

      // 名前でマッチング（SlackIDで見つからない場合）
      if (!employee && applicantName) {
        const name = applicantName.toLowerCase();
        employee = employees.find((e) => {
          const aliases = e.slackAliases.split(/[,、]/).map((a) => a.trim().toLowerCase());
          return (
            e.name === applicantName ||
            e.name.includes(applicantName) ||
            applicantName.includes(e.name) ||
            (e.slackId && e.slackId === applicantSlackId) ||
            aliases.some((a) => a && (a === name || name.includes(a)))
          );
        }) || null;
      }

      // 部門長SlackIDが設定されていれば使用
      if (employee?.deptHeadSlackId) {
        primaryApprover = employee.deptHeadSlackId;
      }
    }
  } catch {
    // 従業員マスタ取得失敗時はデフォルト承認者を使用
  }

  // 代替承認者: ALTERNATE_APPROVERS + ADMIN_APPROVER から primary を除外
  const alternateCandidates = [...ALTERNATE_APPROVERS, ADMIN_APPROVER].filter(
    (id) => id && id !== primaryApprover,
  );
  // 重複排除
  const alternateApprovers = Array.from(new Set(alternateCandidates));

  return {
    primaryApprover,
    alternateApprovers,
    employee,
  };
}
