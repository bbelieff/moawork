import type { Job } from "pg-boss";
import type {
  EsignProvider,
  EsignRequestLoader,
  EsignRequestStatusSink,
  SigningLinkDelivery,
} from "./types.js";

export const ESIGN_SEND_QUEUE = "esign.send";

const ESIGN_ERROR = {
  providerRetry: "provider_retry",
  providerFailed: "provider_failed",
  deliveryRetry: "delivery_retry",
  deliveryFailed: "delivery_failed",
} as const;

export interface EsignSendJobData {
  requestId: string;
}

export interface EsignSendDeps {
  loader: EsignRequestLoader;
  provider: EsignProvider;
  delivery: SigningLinkDelivery;
  sink: EsignRequestStatusSink;
  log?: (message: string) => void;
}

export type EsignSendOutcome =
  | { status: "awaiting_signature"; requestId: string; providerDocumentId: string }
  | { status: "ignored"; requestId: string }
  | { status: "failed"; requestId: string; error: string }
  | { status: "invalid"; error: string };

export function isEsignSendJobData(value: unknown): value is EsignSendJobData {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { requestId?: unknown }).requestId === "string" &&
    (value as { requestId: string }).requestId.length > 0
  );
}

export async function processEsignSendJob(
  deps: EsignSendDeps,
  data: unknown,
): Promise<EsignSendOutcome> {
  const log = deps.log ?? (() => undefined);
  if (!isEsignSendJobData(data)) {
    return { status: "invalid", error: "requestId is required" };
  }

  const { requestId } = data;
  const request = await deps.loader.loadPending(requestId);
  if (!request) {
    return { status: "ignored", requestId };
  }

  const created = request.providerDocumentId && request.signingUrl ? {
    ok: true as const,
    providerDocumentId: request.providerDocumentId,
    signingUrl: request.signingUrl,
  } : await deps.provider.createSigningRequest({
    idempotencyKey: requestId,
    orgId: request.orgId,
    dealId: request.dealId,
    templateId: request.templateId,
    signerReference: request.signerReference,
  });
  if (!created.ok) {
    if (created.retryable) {
      log(`[esign] provider retry requestId=${requestId}`);
      throw new Error(ESIGN_ERROR.providerRetry);
    }
    await deps.sink.markFailed(requestId, ESIGN_ERROR.providerFailed);
    return { status: "failed", requestId, error: ESIGN_ERROR.providerFailed };
  }

  if (!request.providerDocumentId) {
    await deps.sink.markProviderAccepted(requestId, created.providerDocumentId, created.signingUrl);
  }

  const delivered = await deps.delivery.sendSigningLink({
    idempotencyKey: requestId,
    requestId,
    deliveryReference: request.signerReference,
    signingUrl: created.signingUrl,
  });
  if (!delivered.ok) {
    if (delivered.retryable) {
      log(`[esign] delivery retry requestId=${requestId}`);
      throw new Error(ESIGN_ERROR.deliveryRetry);
    }
    await deps.sink.markFailed(requestId, ESIGN_ERROR.deliveryFailed);
    return { status: "failed", requestId, error: ESIGN_ERROR.deliveryFailed };
  }

  await deps.sink.markAwaitingSignature(requestId, created.providerDocumentId);
  return {
    status: "awaiting_signature",
    requestId,
    providerDocumentId: created.providerDocumentId,
  };
}

export function createEsignSendHandler(deps: EsignSendDeps) {
  return async (jobs: Job<EsignSendJobData>[]): Promise<void> => {
    for (const job of jobs) {
      await processEsignSendJob(deps, job.data);
    }
  };
}
