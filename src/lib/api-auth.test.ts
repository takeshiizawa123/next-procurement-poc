import { describe, it, expect, vi, beforeEach } from "vitest";

// 環境変数をモックしてからインポート
beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
  vi.stubEnv("INTERNAL_API_KEY", "test-api-key");
});

// NextRequest のモック
function mockRequest(options: {
  headers?: Record<string, string>;
  searchParams?: Record<string, string>;
  host?: string;
} = {}): any {
  const headers = new Map(Object.entries(options.headers || {}));
  if (options.host) headers.set("host", options.host);
  const params = new URLSearchParams(options.searchParams || {});
  return {
    headers: { get: (key: string) => headers.get(key) || null },
    nextUrl: { searchParams: params },
  };
}

describe("api-auth", () => {
  // 動的インポートで環境変数モック後に読み込む
  async function loadAuth() {
    // vi.stubEnv後に新しいモジュールインスタンスを取得
    const mod = await import("./api-auth");
    return mod;
  }

  describe("requireBearerAuth", () => {
    it("正しいBearer tokenで認証成功（null返却）", async () => {
      const { requireBearerAuth } = await loadAuth();
      const req = mockRequest({ headers: { authorization: "Bearer test-cron-secret" } });
      expect(requireBearerAuth(req)).toBeNull();
    });

    it("不正なtokenで401", async () => {
      const { requireBearerAuth } = await loadAuth();
      const req = mockRequest({ headers: { authorization: "Bearer wrong" } });
      const result = requireBearerAuth(req);
      expect(result).not.toBeNull();
    });

    it("tokenなしで401", async () => {
      const { requireBearerAuth } = await loadAuth();
      const req = mockRequest();
      const result = requireBearerAuth(req);
      expect(result).not.toBeNull();
    });
  });

  describe("requireApiKey", () => {
    it("ヘッダーのx-api-keyで認証成功", async () => {
      const { requireApiKey } = await loadAuth();
      const req = mockRequest({ headers: { "x-api-key": "test-api-key" } });
      expect(requireApiKey(req)).toBeNull();
    });

    it("Bearer tokenフォールバックで認証成功", async () => {
      const { requireApiKey } = await loadAuth();
      const req = mockRequest({ headers: { authorization: "Bearer test-cron-secret" } });
      expect(requireApiKey(req)).toBeNull();
    });

    it("不正なキーで401", async () => {
      const { requireApiKey } = await loadAuth();
      const req = mockRequest({ headers: { "x-api-key": "wrong" } });
      const result = requireApiKey(req);
      expect(result).not.toBeNull();
    });
  });
});
