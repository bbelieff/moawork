import { describe, expect, it, vi } from "vitest";
import { processEsignSendJob, type EsignSendDeps } from "./send.js";

function deps(overrides: Partial<EsignSendDeps> = {}): EsignSendDeps {
  return {
    loader: {
      loadPending: vi.fn().mockResolvedValue({
        requestId: "request_01",
        orgId: "org_01",
        dealId: "deal_01",
        templateId: "template_01",
        signerReference: "contact_01",
      }),
    },
    provider: {
      createSigningRequest: vi.fn().mockResolvedValue({
        ok: true,
        providerDocumentId: "document_01",
        signingUrl: "https://sign.example.invalid/opaque-token",
      }),
    },
    delivery: { sendSigningLink: vi.fn().mockResolvedValue({ ok: true }) },
    sink: {
      markProviderAccepted: vi.fn().mockResolvedValue(undefined),
      markAwaitingSignature: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

describe("processEsignSendJob", () => {
  it("creates and delivers an idempotent signing request without exposing its URL", async () => {
    const current = deps();
    const result = await processEsignSendJob(current, { requestId: "request_01" });

    expect(current.provider.createSigningRequest).toHaveBeenCalledWith({
      idempotencyKey: "request_01",
      orgId: "org_01",
      dealId: "deal_01",
      templateId: "template_01",
      signerReference: "contact_01",
    });
    expect(current.delivery.sendSigningLink).toHaveBeenCalledWith({
      idempotencyKey: "request_01",
      requestId: "request_01",
      deliveryReference: "contact_01",
      signingUrl: "https://sign.example.invalid/opaque-token",
    });
    expect(current.sink.markProviderAccepted).toHaveBeenCalledWith(
      "request_01",
      "document_01",
      "https://sign.example.invalid/opaque-token",
    );
    expect(current.sink.markAwaitingSignature).toHaveBeenCalledWith(
      "request_01",
      "document_01",
    );
    expect(JSON.stringify(result)).not.toContain("sign.example.invalid");
  });

  it("ignores a request that is no longer pending", async () => {
    const current = deps({ loader: { loadPending: vi.fn().mockResolvedValue(null) } });
    await expect(processEsignSendJob(current, { requestId: "request_01" })).resolves.toEqual({
      status: "ignored",
      requestId: "request_01",
    });
    expect(current.provider.createSigningRequest).not.toHaveBeenCalled();
  });

  it("rejects a malformed queue payload before loading customer state", async () => {
    const current = deps();
    await expect(processEsignSendJob(current, { requestId: "" })).resolves.toEqual({
      status: "invalid",
      error: "requestId is required",
    });
    expect(current.loader.loadPending).not.toHaveBeenCalled();
  });

  it("throws retryable provider failures without marking a terminal failure", async () => {
    const log = vi.fn();
    const sensitiveError = "https://sign.example.invalid/document?token=private-value";
    const current = deps({
      log,
      provider: {
        createSigningRequest: vi.fn().mockResolvedValue({
          ok: false,
          retryable: true,
          error: sensitiveError,
        }),
      },
    });
    const result = processEsignSendJob(current, { requestId: "request_01" });
    await expect(result).rejects.toThrow("provider_retry");
    await expect(result).rejects.not.toThrow(sensitiveError);
    expect(current.sink.markFailed).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(sensitiveError);
  });

  it("marks a permanent delivery failure without claiming awaiting signature", async () => {
    const sensitiveError = "https://sign.example.invalid/document?token=private-value";
    const current = deps({
      delivery: {
        sendSigningLink: vi.fn().mockResolvedValue({
          ok: false,
          retryable: false,
          error: sensitiveError,
        }),
      },
    });
    const result = await processEsignSendJob(current, { requestId: "request_01" });
    expect(result).toEqual({
      status: "failed",
      requestId: "request_01",
      error: "delivery_failed",
    });
    expect(current.sink.markFailed).toHaveBeenCalledWith("request_01", "delivery_failed");
    expect(current.sink.markAwaitingSignature).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(sensitiveError);
    expect(JSON.stringify(vi.mocked(current.sink.markFailed).mock.calls)).not.toContain(
      sensitiveError,
    );
  });
});
