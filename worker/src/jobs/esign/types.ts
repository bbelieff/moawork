export interface PendingEsignRequest {
  requestId: string;
  orgId: string;
  dealId: string;
  templateId: string;
  signerReference: string;
  providerDocumentId?: string;
  signingUrl?: string;
}

export interface EsignRequestLoader {
  loadPending(requestId: string): Promise<PendingEsignRequest | null>;
}

export type ProviderCreateResult =
  | { ok: true; providerDocumentId: string; signingUrl: string }
  | { ok: false; retryable: boolean; error: string };

export interface EsignProvider {
  createSigningRequest(input: {
    idempotencyKey: string;
    orgId: string;
    dealId: string;
    templateId: string;
    signerReference: string;
  }): Promise<ProviderCreateResult>;
}

export type SigningDeliveryResult =
  | { ok: true }
  | { ok: false; retryable: boolean; error: string };

/** BBE-114 resolves the recipient from deliveryReference without queueing PII. */
export interface SigningLinkDelivery {
  sendSigningLink(input: {
    idempotencyKey: string;
    requestId: string;
    deliveryReference: string;
    signingUrl: string;
  }): Promise<SigningDeliveryResult>;
}

export interface EsignRequestStatusSink {
  markProviderAccepted(requestId: string, providerDocumentId: string, signingUrl: string): Promise<void>;
  markAwaitingSignature(requestId: string, providerDocumentId: string): Promise<void>;
  markFailed(requestId: string, error: string): Promise<void>;
}

export interface VerifiedProviderEvent {
  kind: "signed" | "other";
  eventId: string;
  providerDocumentId: string;
  occurredAt: string;
}

export interface EsignWebhookVerifier {
  verify(input: {
    rawBody: string;
    signature: string;
  }): Promise<VerifiedProviderEvent | null>;
}

export type ApplySignedOnceResult = "applied" | "duplicate" | "unknown_document";

/**
 * Implementations must atomically map providerDocumentId, record eventId once,
 * set signedAt/contractDate only when absent, and append one audit/history entry.
 */
export interface SignedContractStore {
  applySignedOnce(input: {
    eventId: string;
    providerDocumentId: string;
    signedAt: string;
    contractDate: string;
  }): Promise<ApplySignedOnceResult>;
}
