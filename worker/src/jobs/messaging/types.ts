export type MessagingChannel = "sms" | "alimtalk";
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
  | { ok: false; reason: string; retryable: boolean };

export interface MessagingProvider {
  send(message: MessagingRecord): Promise<ProviderResult>;
}

export type MessagingJobResult =
  | { outcome: "sent"; messageId: string; providerMessageId: string }
  | { outcome: "failed"; messageId: string; reason: string; retryable: boolean };
