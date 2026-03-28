import { getEmployees, type Employee } from "./gas-client";

const DEFAULT_APPROVER = process.env.SLACK_DEFAULT_APPROVER || "";
const ADMIN_APPROVER = process.env.SLACK_ADMIN_APPROVER || "";

export interface ApprovalRoute {
  /** 承認者（部門長）の SlackID */
  primaryApprover: string;
  /** @deprecated 二段階承認は廃止。常に空文字 */
  secondaryApprover: string;
  /** @deprecated 常にfalse */
  requiresSecondApproval: boolean;
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

  // 二段階承認は廃止 — 部門長承認のみ
  const requiresSecondApproval = false;
  const secondaryApprover = "";

  return {
    primaryApprover,
    secondaryApprover,
    requiresSecondApproval,
    employee,
  };
}
