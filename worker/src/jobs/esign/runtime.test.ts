import { describe, expect, it, vi } from "vitest";
import { PostgresEsignRuntime } from "./runtime.js";
import { processEsignSendJob } from "./send.js";

function runtimeFixture() {
  let claimed = false;
  const calls: string[] = [];
  const db = {
    async query<T extends Record<string, unknown>>(sql: string) {
      calls.push(sql);
      if (sql.includes("start_esign_delivery")) {
        if (claimed) return { rows: [] as T[] };
        claimed = true;
        return { rows: [{ request_id: "req", org_id: "org", deal_id: "deal", template_id: "tpl", signer_reference: "01000000000" } as unknown as T] };
      }
      if (sql.includes("enqueue_esign_signing_link")) return { rows: [{ inserted: true } as unknown as T] };
      return { rows: [] as T[] };
    },
  };
  return { runtime: new PostgresEsignRuntime(db, "00000000-0000-4000-8000-000000000001", "sms", "0212345678"), calls };
}

describe("BBE-115 executable chain", () => {
  it("claims once, creates sandbox document, hands link to BBE-30 outbox and awaits signature", async () => {
    const { runtime, calls } = runtimeFixture();
    const provider = { createSigningRequest: vi.fn(async () => ({ ok: true as const, providerDocumentId: "doc", signingUrl: "https://sandbox/sign" })) };
    expect(await processEsignSendJob({ loader: runtime, sink: runtime, delivery: runtime, provider }, { requestId: "req" })).toMatchObject({ status: "awaiting_signature" });
    expect(provider.createSigningRequest).toHaveBeenCalledTimes(1);
    expect(calls.some((x) => x.includes("enqueue_esign_signing_link"))).toBe(true);
    expect(calls.some((x) => x.includes("mark_esign_awaiting"))).toBe(true);
    expect(await processEsignSendJob({ loader: runtime, sink: runtime, delivery: runtime, provider }, { requestId: "req" })).toEqual({ status: "ignored", requestId: "req" });
    expect(provider.createSigningRequest).toHaveBeenCalledTimes(1);
  });

  it("does not call the paid boundary again after a crash following provider admission", async () => {
    const { runtime } = runtimeFixture();
    const provider = { createSigningRequest: vi.fn(async () => ({ ok: true as const, providerDocumentId: "doc", signingUrl: "https://sandbox/sign" })) };
    const crashingDelivery = { sendSigningLink: vi.fn(async () => { throw new Error("simulated process crash"); }) };
    await expect(processEsignSendJob({ loader: runtime, sink: runtime, delivery: crashingDelivery, provider }, { requestId: "req" })).rejects.toThrow("simulated process crash");
    expect(await processEsignSendJob({ loader: runtime, sink: runtime, delivery: crashingDelivery, provider }, { requestId: "req" })).toEqual({ status: "ignored", requestId: "req" });
    expect(provider.createSigningRequest).toHaveBeenCalledTimes(1);
  });
});
