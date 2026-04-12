/**
 * MF会計Plusと証憑自動取得連携しているECサイトの判定
 *
 * 対象: Amazonビジネス, MISUMI-VONA, 楽天市場, Yahoo!ショッピング
 * これらのサイトでの購入は、MF会計Plusが適格請求書/領収書を自動取得するため、
 * 手動での証憑添付が不要。
 */

const EC_LINKED_PATTERNS = [
  /amazon|アマゾン/i,
  /misumi|ミスミ|monotaro/i,
  /楽天|rakuten/i,
  /yahoo|ヤフー/i,
];

/**
 * 購入先がMF会計Plus連携ECサイトかどうかを判定
 */
export function isEcLinkedSite(supplierName: string): boolean {
  if (!supplierName) return false;
  return EC_LINKED_PATTERNS.some((p) => p.test(supplierName));
}

/** 証憑対応ステータス: MF自動取得 */
export const VOUCHER_STATUS_MF_AUTO = "MF自動取得";
