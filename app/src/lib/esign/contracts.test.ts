import { describe, expect, it } from "vitest";
import {
  applyVerifiedSignedEvent,
  buildEsignSendCommand,
  toSeoulContractDate,
  type EsignContractState,
} from "./contracts";

const awaiting: EsignContractState = {
  status: "awaiting_signature",
  signedAt: null,
  contractDate: null,
  processedSignedEventIds: [],
  history: [],
};

describe("buildEsignSendCommand", () => {
  it("keeps only opaque references in the queue-safe command", () => {
    expect(
      buildEsignSendCommand({
        requestId: "request_01",
        orgId: "org_01",
        dealId: "deal_01",
        templateId: "template_01",
        signerReference: "contact_01",
      }),
    ).toEqual({
      requestId: "request_01",
      orgId: "org_01",
      dealId: "deal_01",
      templateId: "template_01",
      signerReference: "contact_01",
    });
  });

  it("rejects direct contact details and malformed references", () => {
    expect(() =>
      buildEsignSendCommand({
        requestId: "request_01",
        orgId: "org_01",
        dealId: "deal_01",
        templateId: "template_01",
        signerReference: "person@example.com",
      }),
    ).toThrow("signerReference must be an opaque reference");
  });
});

describe("signed contract transition", () => {
  const event = {
    eventId: "event_01",
    providerDocumentId: "document_01",
    signedAt: "2026-08-10T15:30:00.000Z",
  };

  it("uses the Seoul calendar date at the UTC boundary", () => {
    expect(toSeoulContractDate(event.signedAt)).toBe("2026-08-11");
  });

  it("sets signed state, contract date, and history once", () => {
    const first = applyVerifiedSignedEvent(awaiting, event);
    expect(first.outcome).toBe("applied");
    expect(first.state).toMatchObject({
      status: "signed",
      signedAt: event.signedAt,
      contractDate: "2026-08-11",
      processedSignedEventIds: ["event_01"],
    });
    expect(first.state.history).toEqual([
      { kind: "signed", eventId: "event_01", occurredAt: event.signedAt },
    ]);

    const duplicate = applyVerifiedSignedEvent(first.state, event);
    expect(duplicate).toEqual({ outcome: "duplicate", state: first.state });
  });

  it("does not overwrite a contract date with a later signed event", () => {
    const first = applyVerifiedSignedEvent(awaiting, event);
    const later = applyVerifiedSignedEvent(first.state, {
      ...event,
      eventId: "event_02",
      signedAt: "2026-08-12T01:00:00.000Z",
    });
    expect(later).toEqual({ outcome: "already_signed", state: first.state });
  });

  it("rejects an invalid signed instant", () => {
    expect(() => toSeoulContractDate("not-a-date")).toThrow(
      "signedAt must be a valid instant",
    );
  });
});
