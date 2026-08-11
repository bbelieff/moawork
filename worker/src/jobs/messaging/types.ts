export type MessagingChannel = "sms" | "alimtalk";
export const MESSAGING_PROVIDER_FAILURE = {
  retry: "provider_retry",
  failed: "provider_failed",
} as const;
export type MessagingProviderFailure =
  (typeof MESSAGING_PROVIDER_FAILURE)[keyof typeof MESSAGING_PROVIDER_FAILURE];

export interface MessagingRecord {
  id: string;
  channel: MessagingChannel;
  toDigits: string;
  fromDigits: string;
  body: string;
  templateCode?: string;
  senderProfileId?: string;
}

export type ProviderResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; reason: MessagingProviderFailure; retryable: boolean };

export interface MessagingProvider {
  send(message: MessagingRecord): Promise<ProviderResult>;
}

export type MessagingJobResult =
  | { outcome: "sent"; messageId: string; providerMessageId: string }
  | {
      outcome: "failed";
      messageId: string;
      reason: MessagingProviderFailure;
      retryable: boolean;
    };
