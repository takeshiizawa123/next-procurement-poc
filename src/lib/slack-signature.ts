/**
 * Slack署名検証ロジック（テスト可能な形で抽出）
 */
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Slackリクエスト署名を検証（HMAC-SHA256）
 * @returns true: 検証成功, false: 検証失敗
 */
export function verifySlackSignature(
  body: string,
  timestamp: string,
  signature: string,
  signingSecret: string,
): boolean {
  if (!signingSecret) return false;
  // リプレイ攻撃防止: 5分以上古いリクエストを拒否
  const now = Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) return false;

  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature = "v0=" + createHmac("sha256", signingSecret).update(sigBasestring).digest("hex");

  try {
    return timingSafeEqual(Buffer.from(mySignature), Buffer.from(signature));
  } catch {
    return false;
  }
}
