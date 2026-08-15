import { describe, expect, it, vi } from "vitest";
import { PostgresEsignRuntime } from "./runtime.js";
import { processEsignSendJob } from "./send.js";

function runtimeFixture() {
  let state: "queued" | "started" | "accepted" | "awaiting" = "queued";
  let outboxCount = 0;
  const calls: string[] = [];
  const db = {
    async query<T extends Record<string, unknown>>(sql: string) {
      calls.push(sql);
      if (sql.includes("start_esign_delivery")) {
        if (state === "queued") state = "started";
        else if (state !== "accepted") return { rows: [] as T[] };
        return { rows: [{ request_id: "req", org_id: "org", deal_id: "deal", template_id: "tpl", signer_reference: "01000000000", provider_document_id: state === "accepted" ? "doc" : null, provider_signing_url: state === "accepted" ? "https://sandbox/sign" : null } as unknown as T] };
      }
      if (sql.includes("mark_esign_provider_accepted")) state = "accepted";
      if (sql.includes("enqueue_esign_signing_link")) {
        outboxCount = 1;
        return { rows: [{ inserted: true } as unknown as T] };
      }
      if (sql.includes("mark_esign_awaiting")) state = "awaiting";
      return { rows: [] as T[] };
    },
  };
  return {
    runtime: new PostgresEsignRuntime(db, "00000000-0000-4000-8000-000000000001", "sms", "0212345678"),
    calls,
    outboxCount: () => outboxCount,
  };
}

const provider = () => ({ createSigningRequest: vi.fn(async () => ({ ok: true as const, providerDocumentId: "doc", signingUrl: "https://sandbox/sign" })) });

describe("BBE-115 executable chain", () => {
  it("persists provider acceptance before the BBE-30 handoff", async () => {
    const { runtime, calls } = runtimeFixture();
    const currentProvider = provider();
    expect(await processEsignSendJob({ loader: runtime, sink: runtime, delivery: runtime, provider: currentProvider }, { requestId: "req" })).toMatchObject({ status: "awaiting_signature" });
    expect(calls.findIndex((x) => x.includes("mark_esign_provider_accepted"))).toBeLessThan(calls.findIndex((x) => x.includes("enqueue_esign_signing_link")));
    expect(currentProvider.createSigningRequest).toHaveBeenCalledTimes(1);
  });

  it("resumes after the provider-ack crash without another provider call", async () => {
    const { runtime, outboxCount } = runtimeFixture();
    const currentProvider = provider();
    const crashBeforeHandoff = { sendSigningLink: vi.fn(async () => { throw new Error("crash-after-provider-ack"); }) };
    await expect(processEsignSendJob({ loader: runtime, sink: runtime, delivery: crashBeforeHandoff, provider: currentProvider }, { requestId: "req" })).rejects.toThrow("crash-after-provider-ack");
    expect(await processEsignSendJob({ loader: runtime, sink: runtime, delivery: runtime, provider: currentProvider }, { requestId: "req" })).toMatchObject({ status: "awaiting_signature", providerDocumentId: "doc" });
    expect(currentProvider.createSigningRequest).toHaveBeenCalledTimes(1);
    expect(outboxCount()).toBe(1);
  });

  it("resumes after the outbox-handoff crash with one provider call and at most one outbox", async () => {
    const { runtime, outboxCount } = runtimeFixture();
    const currentProvider = provider();
    const sink = {
      markProviderAccepted: runtime.markProviderAccepted.bind(runtime),
      markFailed: runtime.markFailed.bind(runtime),
      markAwaitingSignature: vi.fn().mockRejectedValueOnce(new Error("crash-after-handoff")).mockImplementation(runtime.markAwaitingSignature.bind(runtime)),
    };
    await expect(processEsignSendJob({ loader: runtime, sink, delivery: runtime, provider: currentProvider }, { requestId: "req" })).rejects.toThrow("crash-after-handoff");
    expect(await processEsignSendJob({ loader: runtime, sink, delivery: runtime, provider: currentProvider }, { requestId: "req" })).toMatchObject({ status: "awaiting_signature" });
    expect(currentProvider.createSigningRequest).toHaveBeenCalledTimes(1);
    expect(outboxCount()).toBe(1);
  });
});
