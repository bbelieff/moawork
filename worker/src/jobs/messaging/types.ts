export type MessagingChannel = "sms" | "alimtalk";
export type MessagingStatus = "queued" | "sending" | "sent" | "failed" | "excluded";

export interface MessagingRecord {
  id: string;
  status: MessagingStatus;
  channel: MessagingChannel;
  toDigits: string;
  fromDigits: string;
  body: string;
  templateCode?: string;
  senderProfileId?: string;
}

export interface MessagingJobData {
  messageId: string;
}

export interface MessagingStore {
  claim(messageId: string): Promise<MessagingRecord | null>;
  markSent(messageId: string, providerMessageId: string): Promise<void>;
  markFailed(messageId: string, reason: string): Promise<void>;
}

export interface MessagingDispatchSource {
  listQueued(limit: number): Promise<readonly string[]>;
}

export type ProviderResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; reason: string; retryable: boolean };

export interface MessagingProvider {
  send(message: MessagingRecord): Promise<ProviderResult>;
}

export type MessagingJobResult =
  | { outcome: "sent"; messageId: string }
  | { outcome: "duplicate"; messageId: string }
  | { outcome: "failed"; messageId: string; reason: string };
