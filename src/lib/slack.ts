/**
 * Slack モジュール — ファサード
 *
 * 全エクスポートを3つのサブモジュールから再エクスポートする。
 * 既存の `import { ... } from "@/lib/slack"` を一切変更不要にするための互換レイヤー。
 *
 * 内部構成:
 * - slack-client.ts  — WebClient、安全装置(FORCE_TEST_MODE)、ヘルパー (~170行)
 * - slack-messages.ts — Block Kit ビルダー、OPS通知、承認DM (~470行)
 * - slack-actions.ts  — アクションハンドラー、モーダル、Web同期 (~1,650行)
 */

// --- slack-client.ts ---
export {
  safeDmChannel,
  getSlackClient,
  safeUpdateStatus,
  extractRequestInfoFromBlocks,
  parseActionValue,
  DEV_ADMIN_SLACK_ID,
} from "./slack-client";
export type { SlackActionHandler } from "./slack-client";

// --- slack-messages.ts ---
export {
  buildNewRequestBlocks,
  buildApprovedBlocks,
  buildRejectedBlocks,
  buildOrderedBlocks,
  buildInspectedBlocks,
  buildCancelledBlocks,
  buildReturnedBlocks,
  buildPurchasedRequestBlocks,
  buildActionValue,
  calcPaymentDueDate,
  notifyOps,
  sendApprovalDM,
} from "./slack-messages";
export type { RequestInfo } from "./slack-messages";

// --- slack-actions.ts ---
export {
  handleApprove,
  handleReject,
  handleOrderComplete,
  handlePartialInspection,
  handleInspectionComplete,
  handleCancel,
  handleReturn,
  handleReturnSubmit,
  handleDmApprove,
  handleDmReject,
  handleOpenModal,
  handleJournalRegister,
  sendAmountDiffApproval,
  actionHandlers,
  handlePurchaseCommand,
  handlePoTestCommand,
  parsePurchaseFormValues,
  updateSlackMessageForWebAction,
  savePurchaseDraft,
  loadPurchaseDraft,
  clearPurchaseDraft,
} from "./slack-actions";
export type { PurchaseFormData } from "./slack-actions";
