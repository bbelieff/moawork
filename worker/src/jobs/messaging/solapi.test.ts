import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { SolapiProvider, solapiAuthorization } from "./solapi.js";

describe("SolapiProvider", () => {
  it("creates the official HMAC-SHA256 authorization shape without exposing the secret", () => {
    const date = "2026-08-11T00:00:00.000Z";
    const salt = "fixed-salt";
    const signature = createHmac("sha256", "secret").update(date + salt).digest("hex");
    const header = solapiAuthorization({ apiKey: "key", apiSecret: "secret" }, date, salt);
    expect(header).toBe(`HMAC-SHA256 apiKey=key, date=${date}, salt=${salt}, signature=${signature}`);
    expect(header).not.toContain("secret");
  });

  it("formats the phone only at send time and returns the provider message id", async () => {
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.messages[0]).toMatchObject({ to: "01012345678", from: "0212345678", type: "SMS" });
      return new Response(JSON.stringify({ messageList: [{ messageId: "provider-1" }] }), { status: 200 });
    });
    const provider = new SolapiProvider({ apiKey: "key", apiSecret: "secret" }, request as typeof fetch);

    await expect(provider.send({
      id: "m1",
      channel: "sms",
      toDigits: "010-1234-5678",
      fromDigits: "02-1234-5678",
      body: "안내",
    })).resolves.toEqual({ ok: true, providerMessageId: "provider-1" });
  });

  it("discards provider status text and returns only a fixed internal code", async () => {
    const sensitive = "https://provider.invalid/failure?token=private user@example.invalid";
    const request = vi.fn(async () => new Response(JSON.stringify({
      failedMessageList: [{ statusMessage: sensitive }],
    }), { status: 400 }));
    const provider = new SolapiProvider(
      { apiKey: "key", apiSecret: "secret" },
      request as typeof fetch,
    );

    const result = await provider.send({
      id: "m1",
      channel: "sms",
      toDigits: "01012345678",
      fromDigits: "0212345678",
      body: "안내",
    });

    expect(result).toEqual({ ok: false, reason: "provider_failed", retryable: false });
    expect(JSON.stringify(result)).not.toContain(sensitive);
  });

});
