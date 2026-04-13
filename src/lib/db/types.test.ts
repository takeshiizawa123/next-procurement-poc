import { describe, it, expect } from "vitest";
import {
  ok,
  ng,
  deriveApprovalStatus,
  deriveOrderStatus,
  deriveVoucherStatus,
  deriveInspectionStatus,
} from "./types";

describe("ok / ng ヘルパー", () => {
  it("ok() は success: true を返す", () => {
    const result = ok({ prNumber: "PO-202604-0001" });
    expect(result.success).toBe(true);
    expect(result.data?.prNumber).toBe("PO-202604-0001");
    expect(result.error).toBeNull();
    expect(result.statusCode).toBe(200);
  });

  it("ng() は success: false を返す", () => {
    const result = ng("Not found", 404);
    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.error).toBe("Not found");
    expect(result.statusCode).toBe(404);
  });

  it("ng() デフォルトステータスは500", () => {
    const result = ng("Server error");
    expect(result.statusCode).toBe(500);
  });
});

describe("ステータス派生関数", () => {
  describe("deriveApprovalStatus", () => {
    it("申請済 → 承認待ち", () => expect(deriveApprovalStatus("申請済")).toBe("承認待ち"));
    it("差戻し → 差戻し", () => expect(deriveApprovalStatus("差戻し")).toBe("差戻し"));
    it("取消 → 取消", () => expect(deriveApprovalStatus("取消")).toBe("取消"));
    it("承認済 → 承認済", () => expect(deriveApprovalStatus("承認済")).toBe("承認済"));
    it("発注済 → 承認済", () => expect(deriveApprovalStatus("発注済")).toBe("承認済"));
    it("検収済 → 承認済", () => expect(deriveApprovalStatus("検収済")).toBe("承認済"));
    it("計上済 → 承認済", () => expect(deriveApprovalStatus("計上済")).toBe("承認済"));
  });

  describe("deriveOrderStatus", () => {
    it("申請済 → 未発注", () => expect(deriveOrderStatus("申請済")).toBe("未発注"));
    it("承認済 → 未発注", () => expect(deriveOrderStatus("承認済")).toBe("未発注"));
    it("差戻し → 未発注", () => expect(deriveOrderStatus("差戻し")).toBe("未発注"));
    it("取消 → 未発注", () => expect(deriveOrderStatus("取消")).toBe("未発注"));
    it("発注済 → 発注済", () => expect(deriveOrderStatus("発注済")).toBe("発注済"));
    it("検収済 → 発注済", () => expect(deriveOrderStatus("検収済")).toBe("発注済"));
    it("証憑完了 → 発注済", () => expect(deriveOrderStatus("証憑完了")).toBe("発注済"));
  });

  describe("deriveInspectionStatus", () => {
    it("申請済 → 未検収", () => expect(deriveInspectionStatus("申請済")).toBe("未検収"));
    it("承認済 → 未検収", () => expect(deriveInspectionStatus("承認済")).toBe("未検収"));
    it("発注済 → 未検収", () => expect(deriveInspectionStatus("発注済")).toBe("未検収"));
    it("検収済 → 検収済", () => expect(deriveInspectionStatus("検収済")).toBe("検収済"));
    it("証憑完了 → 検収済", () => expect(deriveInspectionStatus("証憑完了")).toBe("検収済"));
  });

  describe("deriveVoucherStatus", () => {
    it("検収前はすべて未対応", () => {
      expect(deriveVoucherStatus("none", "申請済")).toBe("未対応");
      expect(deriveVoucherStatus("uploaded", "承認済")).toBe("未対応");
      expect(deriveVoucherStatus("none", "発注済")).toBe("未対応");
      expect(deriveVoucherStatus("none", "差戻し")).toBe("未対応");
      expect(deriveVoucherStatus("none", "取消")).toBe("未対応");
    });

    it("検収後 none → 要取得", () => {
      expect(deriveVoucherStatus("none", "検収済")).toBe("要取得");
    });

    it("検収後 uploaded → 添付済", () => {
      expect(deriveVoucherStatus("uploaded", "検収済")).toBe("添付済");
    });

    it("検収後 verified → 添付済（uploadedと同じ）", () => {
      expect(deriveVoucherStatus("verified", "検収済")).toBe("添付済");
    });

    it("検収後 mf_auto → MF自動取得", () => {
      expect(deriveVoucherStatus("mf_auto", "検収済")).toBe("MF自動取得");
    });

    it("計上済でも証憑ステータスは正しく変換", () => {
      expect(deriveVoucherStatus("uploaded", "計上済")).toBe("添付済");
      expect(deriveVoucherStatus("none", "計上済")).toBe("要取得");
    });
  });
});
