export const MESSAGE_TRIGGER_VALUES = [
  "간편 부재 1회",
  "간편 부재 2회",
  "간편 부재 3회",
  "간편 부재 4회",
  "간편 부재 5회",
  "악성 부재",
  "1차 상담 안내",
  "2차 확정 안내",
  "미팅확정 메세지",
] as const;

export type MessageTriggerValue = (typeof MESSAGE_TRIGGER_VALUES)[number];
export type MessageChannel = "sms" | "alimtalk";

export interface MessageTarget {
  entityId: string;
  phone: string;
}

export interface MessageBatchCommand {
  orgId: string;
  batchKey: string;
  columnKey: string;
  value: MessageTriggerValue;
  channel: MessageChannel;
  templateCode: string;
  targets: readonly MessageTarget[];
}

export interface MessageBatchResult {
  batchId: string;
  requested: number;
  queued: number;
  duplicate: number;
  excluded: number;
  failed: number;
}

export type MessageReservation =
  | { outcome: "queued"; messageId: string }
  | { outcome: "duplicate"; messageId: string }
  | { outcome: "excluded"; reason: string }
  | { outcome: "failed"; reason: string };

export interface MessageReservationInput {
  orgId: string;
  batchKey: string;
  entityId: string;
  phoneDigits: string;
  idempotencyKey: string;
  columnKey: string;
  value: MessageTriggerValue;
  channel: MessageChannel;
  templateCode: string;
}

export interface MessageOutboxPort {
  reserve(input: MessageReservationInput): Promise<MessageReservation>;
  markQueueFailed(messageId: string, reason: string): Promise<void>;
  finishBatch(batchKey: string, result: Omit<MessageBatchResult, "batchId">): Promise<string>;
}

export interface MessageQueuePort {
  enqueue(messageId: string): Promise<void>;
}
