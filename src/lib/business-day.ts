/**
 * 銀行営業日・休日判定ユーティリティ
 *
 * 日本の祝日 + 土日 + 年末年始(12/31〜1/3) を銀行休業日扱いし、
 * 約定支払日を実支払日に繰延算出する。
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const jh = require("japanese-holidays");

/**
 * 銀行休業日判定
 * - 土曜日・日曜日
 * - 祝日（振替休日含む）
 * - 年末年始 12/31〜1/3
 */
export function isBankHoliday(date: Date): boolean {
  const day = date.getDay();
  if (day === 0 || day === 6) return true; // 土日

  const m = date.getMonth() + 1;
  const d = date.getDate();
  // 年末年始
  if (m === 12 && d === 31) return true;
  if (m === 1 && d >= 1 && d <= 3) return true;

  // 祝日・振替休日
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const holiday = jh.isHoliday(date) as any;
  if (holiday) return true;

  return false;
}

/**
 * 指定日以降の最初の銀行営業日を返す
 * 指定日自体が営業日ならそのまま返す
 */
export function nextBusinessDay(date: Date): Date {
  const result = new Date(date.getTime());
  while (isBankHoliday(result)) {
    result.setDate(result.getDate() + 1);
  }
  return result;
}

/**
 * paymentDay (1-31) と対象月から、約定支払日を返す
 * paymentDay=31 は月末扱い
 */
export function scheduledPaymentDate(paymentDay: number, year: number, month: number): Date {
  if (paymentDay === 31) {
    // 月末扱い: 翌月の0日目 = 当月末日
    return new Date(year, month, 0);
  }
  // 1-30
  const d = new Date(year, month - 1, paymentDay);
  // 2月30日などの無効日付は月末に丸める
  if (d.getMonth() !== month - 1) {
    return new Date(year, month, 0);
  }
  return d;
}

/**
 * 休日繰延を適用した実支払日を返す
 */
export function resolvedPaymentDate(paymentDay: number, year: number, month: number): Date {
  return nextBusinessDay(scheduledPaymentDate(paymentDay, year, month));
}

/**
 * 2つの日付の日数差（絶対値）
 */
export function daysDiff(a: Date, b: Date): number {
  return Math.floor(Math.abs(a.getTime() - b.getTime()) / 86400000);
}

/**
 * Date → YYYY-MM-DD 文字列（JST）
 */
export function formatDateJST(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
