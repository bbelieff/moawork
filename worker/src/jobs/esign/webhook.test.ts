import { describe, expect, it, vi } from "vitest";
import { processEsignWebhook, type EsignWebhookDeps } from "./webhook.js";

function deps(overrides: Partial<EsignWebhookDeps> = {}): EsignWebhookDeps {
  return {
    verifier: {
      verify: vi.fn().mockResolvedValue({
        kind: "signed",
        eventId: "event_01",
        providerDocumentId: "document_01",
        occurredAt: "2026-08-10T15:30:00.000Z",
      }),
    },
    store: { applySignedOnce: vi.fn().mockResolvedValue("applied") },
    ...overrides,
  };
}

describe("processEsignWebhook", () => {
  const input = { rawBody: "opaque-body", signature: "opaque-signature" };

  it("fails closed before storage when signature verification fails", async () => {
    const current = deps({ verifier: { verify: vi.fn().mockResolvedValue(null) } });
    await expect(processEsignWebhook(current, input)).resolves.toEqual({ status: "rejected" });
    expect(current.store.applySignedOnce).not.toHaveBeenCalled();
  });

  it("applies the verified signed signal with a Seoul contract date", async () => {
    const current = deps();
    await expect(processEsignWebhook(current, input)).resolves.toEqual({
      status: "applied",
      eventId: "event_01",
    });
    expect(current.store.applySignedOnce).toHaveBeenCalledWith({
      eventId: "event_01",
      providerDocumentId: "document_01",
      signedAt: "2026-08-10T15:30:00.000Z",
      contractDate: "2026-08-11",
    });
  });

  it("reports an atomic duplicate without a second application", async () => {
    const current = deps({ store: { applySignedOnce: vi.fn().mockResolvedValue("duplicate") } });
    await expect(processEsignWebhook(current, input)).resolves.toEqual({
      status: "duplicate",
      eventId: "event_01",
    });
    expect(current.store.applySignedOnce).toHaveBeenCalledTimes(1);
  });

  it("ignores a verified event that is not a signed signal", async () => {
    const current = deps({
      verifier: {
        verify: vi.fn().mockResolvedValue({
          kind: "other",
          eventId: "event_02",
          providerDocumentId: "document_01",
          occurredAt: "2026-08-10T15:30:00.000Z",
        }),
      },
    });
    await expect(processEsignWebhook(current, input)).resolves.toEqual({
      status: "ignored",
      eventId: "event_02",
    });
    expect(current.store.applySignedOnce).not.toHaveBeenCalled();
  });

  it("rejects malformed verified events and retries an unknown document", async () => {
    const malformed = deps({
      verifier: {
        verify: vi.fn().mockResolvedValue({
          kind: "signed",
          eventId: "bad event",
          providerDocumentId: "document_01",
          occurredAt: "2026-08-10T15:30:00.000Z",
        }),
      },
    });
    await expect(processEsignWebhook(malformed, input)).rejects.toThrow(
      "eventId must be an opaque reference",
    );
    expect(malformed.store.applySignedOnce).not.toHaveBeenCalled();

    const unknown = deps({
      store: { applySignedOnce: vi.fn().mockResolvedValue("unknown_document") },
    });
    await expect(processEsignWebhook(unknown, input)).rejects.toThrow(
      "signed document is not registered",
    );
  });
});
