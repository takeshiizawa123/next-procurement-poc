import { describe, it, expect, vi } from "vitest";
import { createHmac } from "crypto";
import { verifySlackSignature } from "./slack-signature";

const SECRET = "test_signing_secret_abc123";

function makeSignature(body: string, timestamp: string, secret: string): string {
  const sig = createHmac("sha256", secret)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex");
  return `v0=${sig}`;
}

describe("verifySlackSignature", () => {
  it("正しい署名を検証成功", () => {
    const now = String(Math.floor(Date.now() / 1000));
    const body = '{"type":"url_verification","challenge":"abc"}';
    const sig = makeSignature(body, now, SECRET);
    expect(verifySlackSignature(body, now, sig, SECRET)).toBe(true);
  });

  it("不正な署名を拒否", () => {
    const now = String(Math.floor(Date.now() / 1000));
    const body = '{"type":"event_callback"}';
    expect(verifySlackSignature(body, now, "v0=invalid", SECRET)).toBe(false);
  });

  it("空のsigningSecretを拒否", () => {
    const now = String(Math.floor(Date.now() / 1000));
    const body = "test";
    const sig = makeSignature(body, now, SECRET);
    expect(verifySlackSignature(body, now, sig, "")).toBe(false);
  });

  it("5分以上前のタイムスタンプを拒否（リプレイ攻撃防止）", () => {
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 400); // 6分40秒前
    const body = "test";
    const sig = makeSignature(body, oldTimestamp, SECRET);
    expect(verifySlackSignature(body, oldTimestamp, sig, SECRET)).toBe(false);
  });

  it("5分以内のタイムスタンプは許可", () => {
    const recentTimestamp = String(Math.floor(Date.now() / 1000) - 200); // 3分20秒前
    const body = "test";
    const sig = makeSignature(body, recentTimestamp, SECRET);
    expect(verifySlackSignature(body, recentTimestamp, sig, SECRET)).toBe(true);
  });

  it("不正なタイムスタンプ（NaN）を拒否", () => {
    const body = "test";
    const sig = makeSignature(body, "invalid", SECRET);
    expect(verifySlackSignature(body, "invalid", sig, SECRET)).toBe(false);
  });

  it("改ざんされたボディを拒否", () => {
    const now = String(Math.floor(Date.now() / 1000));
    const body = '{"type":"event_callback"}';
    const sig = makeSignature(body, now, SECRET);
    // ボディを改ざん
    expect(verifySlackSignature('{"type":"HACKED"}', now, sig, SECRET)).toBe(false);
  });
});
