import type {
  EsignWebhookVerifier,
  SignedContractStore,
  VerifiedProviderEvent,
} from "./types.js";

export interface EsignWebhookDeps {
  verifier: EsignWebhookVerifier;
  store: SignedContractStore;
}

export type EsignWebhookOutcome =
  | { status: "rejected" }
  | { status: "ignored"; eventId: string }
  | { status: "applied"; eventId: string }
  | { status: "duplicate"; eventId: string };

function requireEventField(value: string, field: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(value)) {
    throw new TypeError(`${field} must be an opaque reference`);
  }
}

export function toSeoulContractDate(instant: string): string {
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("occurredAt must be a valid instant");
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

function validateVerifiedEvent(event: VerifiedProviderEvent): void {
  requireEventField(event.eventId, "eventId");
  requireEventField(event.providerDocumentId, "providerDocumentId");
  toSeoulContractDate(event.occurredAt);
}

export async function processEsignWebhook(
  deps: EsignWebhookDeps,
  input: { rawBody: string; signature: string },
): Promise<EsignWebhookOutcome> {
  const event = await deps.verifier.verify(input);
  if (!event) {
    return { status: "rejected" };
  }
  validateVerifiedEvent(event);

  if (event.kind !== "signed") {
    return { status: "ignored", eventId: event.eventId };
  }

  const result = await deps.store.applySignedOnce({
    eventId: event.eventId,
    providerDocumentId: event.providerDocumentId,
    signedAt: event.occurredAt,
    contractDate: toSeoulContractDate(event.occurredAt),
  });
  if (result === "unknown_document") {
    throw new Error("signed document is not registered");
  }
  return { status: result, eventId: event.eventId };
}
