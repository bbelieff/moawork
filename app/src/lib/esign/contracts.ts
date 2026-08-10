export type EsignStatus = "queued" | "awaiting_signature" | "signed" | "failed";

export interface EsignSendCommand {
  requestId: string;
  orgId: string;
  dealId: string;
  templateId: string;
  signerReference: string;
}

export interface EsignSendInput {
  requestId: unknown;
  orgId: unknown;
  dealId: unknown;
  templateId: unknown;
  signerReference: unknown;
}

export interface VerifiedSignedEvent {
  eventId: string;
  providerDocumentId: string;
  signedAt: string;
}

export interface EsignHistoryEntry {
  kind: "signed";
  eventId: string;
  occurredAt: string;
}

export interface EsignContractState {
  status: EsignStatus;
  signedAt: string | null;
  contractDate: string | null;
  processedSignedEventIds: readonly string[];
  history: readonly EsignHistoryEntry[];
}

export type ApplySignedEventResult =
  | { outcome: "applied"; state: EsignContractState }
  | { outcome: "duplicate"; state: EsignContractState }
  | { outcome: "already_signed"; state: EsignContractState };

const OPAQUE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;

function requireOpaqueReference(value: unknown, field: string): string {
  if (typeof value !== "string" || !OPAQUE_REFERENCE.test(value)) {
    throw new TypeError(`${field} must be an opaque reference`);
  }
  return value;
}

/**
 * Builds the queue-safe command. Direct contact details and document contents are
 * deliberately excluded; external adapters resolve these opaque references.
 */
export function buildEsignSendCommand(input: EsignSendInput): EsignSendCommand {
  return {
    requestId: requireOpaqueReference(input.requestId, "requestId"),
    orgId: requireOpaqueReference(input.orgId, "orgId"),
    dealId: requireOpaqueReference(input.dealId, "dealId"),
    templateId: requireOpaqueReference(input.templateId, "templateId"),
    signerReference: requireOpaqueReference(input.signerReference, "signerReference"),
  };
}

/** Converts a signed instant into the contract calendar date used in Seoul. */
export function toSeoulContractDate(instant: string): string {
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("signedAt must be a valid instant");
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

/**
 * Pure reference reducer for persistence adapters. Production storage must apply
 * the same transition atomically so duplicate provider delivery cannot append a
 * second history item or change the original contract date.
 */
export function applyVerifiedSignedEvent(
  state: EsignContractState,
  event: VerifiedSignedEvent,
): ApplySignedEventResult {
  requireOpaqueReference(event.eventId, "eventId");
  requireOpaqueReference(event.providerDocumentId, "providerDocumentId");
  const contractDate = toSeoulContractDate(event.signedAt);

  if (state.processedSignedEventIds.includes(event.eventId)) {
    return { outcome: "duplicate", state };
  }

  if (state.status === "signed" || state.contractDate !== null || state.signedAt !== null) {
    return { outcome: "already_signed", state };
  }

  return {
    outcome: "applied",
    state: {
      ...state,
      status: "signed",
      signedAt: event.signedAt,
      contractDate,
      processedSignedEventIds: [...state.processedSignedEventIds, event.eventId],
      history: [
        ...state.history,
        { kind: "signed", eventId: event.eventId, occurredAt: event.signedAt },
      ],
    },
  };
}
