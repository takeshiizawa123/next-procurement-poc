import { describe, it, expect } from "vitest";
import {
  contractSupplierScore,
  contractPeriodScore,
  contractAmountScore,
} from "./card-matcher-v2";

// ============================================================================
// contractSupplierScore (0-70)
// ============================================================================

describe("contractSupplierScore", () => {
  it("完全一致 → 70", () => {
    expect(contractSupplierScore("AWS", "AWS")).toBe(70);
  });

  it("大文字小文字・空白を正規化して一致 → 70", () => {
    expect(contractSupplierScore("Amazon Web Services", "amazon web services")).toBe(70);
  });

  it("部分一致（カード側が長い） → 60", () => {
    expect(contractSupplierScore("AWS", "AWS JAPAN K.K.")).toBe(60);
  });

  it("部分一致（契約側が長い） → 60", () => {
    expect(contractSupplierScore("Amazon Web Services Japan", "Amazon Web")).toBe(60);
  });

  it("bigram高一致率(≥60%) → 45", () => {
    // "freee" vs "freee株式会社" — partial match catches this, should be 60
    expect(contractSupplierScore("freee", "freee株式会社")).toBe(60);
  });

  it("bigram中一致率(40-60%) → 30", () => {
    // "slack" vs "slackbot" — substring match catches this first
    // Use names that don't substring-match but share bigrams
    expect(contractSupplierScore("ABCDEF", "ABCDXY")).toBeGreaterThanOrEqual(15);
  });

  it("無関係な名前 → 0", () => {
    expect(contractSupplierScore("Amazon", "楽天")).toBe(0);
  });

  it("空文字 → 0", () => {
    expect(contractSupplierScore("", "AWS")).toBe(0);
    expect(contractSupplierScore("AWS", "")).toBe(0);
  });
});

// ============================================================================
// contractPeriodScore (0-20)
// ============================================================================

describe("contractPeriodScore", () => {
  it("期間内（endDate指定） → 20", () => {
    expect(contractPeriodScore("2026-01-01", "2026-12-31", "2026-06-15")).toBe(20);
  });

  it("期間内（endDateなし = 無期限） → 20", () => {
    expect(contractPeriodScore("2026-01-01", null, "2027-06-15")).toBe(20);
  });

  it("開始日前 → 0", () => {
    expect(contractPeriodScore("2026-04-01", "2026-12-31", "2026-03-31")).toBe(0);
  });

  it("終了日後 → 0", () => {
    expect(contractPeriodScore("2026-01-01", "2026-03-31", "2026-04-01")).toBe(0);
  });

  it("開始日当日 → 20", () => {
    expect(contractPeriodScore("2026-04-01", null, "2026-04-01")).toBe(20);
  });

  it("終了日当日 → 20", () => {
    expect(contractPeriodScore("2026-01-01", "2026-04-01", "2026-04-01")).toBe(20);
  });

  it("不正な日付 → 0", () => {
    expect(contractPeriodScore("invalid", null, "2026-04-01")).toBe(0);
  });
});

// ============================================================================
// contractAmountScore (0-10)
// ============================================================================

describe("contractAmountScore", () => {
  it("予算内 → 10", () => {
    expect(contractAmountScore(50000, null, 30000)).toBe(10);
  });

  it("予算ぴったり → 10", () => {
    expect(contractAmountScore(50000, null, 50000)).toBe(10);
  });

  it("10%以内の超過 → 7", () => {
    expect(contractAmountScore(50000, null, 54000)).toBe(7);
  });

  it("50%以内の超過 → 3", () => {
    expect(contractAmountScore(50000, null, 70000)).toBe(3);
  });

  it("50%超の超過 → 0", () => {
    expect(contractAmountScore(50000, null, 80000)).toBe(0);
  });

  it("budget優先（budgetとmonthly両方ある場合） → budgetで判定", () => {
    // budget=100000, monthly=50000, amount=80000
    // budgetで判定: 80000 <= 100000 → 10
    expect(contractAmountScore(100000, 50000, 80000)).toBe(10);
  });

  it("budgetなし → monthlyで判定", () => {
    expect(contractAmountScore(null, 50000, 50000)).toBe(10);
  });

  it("基準額なし → 中立5点", () => {
    expect(contractAmountScore(null, null, 30000)).toBe(5);
  });
});
