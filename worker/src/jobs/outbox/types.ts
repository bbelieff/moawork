export type OutboxActorKind = "person" | "automation";
export type OutboxStatus = "pending" | "leased" | "delivered" | "retry" | "dead";

export interface OutboxActor {
  kind: OutboxActorKind;
  id: string;
}

export interface OutboxDelivery {
  outboxId: string;
  messageId: string;
  attempt: number;
  actor: OutboxActor;
}

export type DeliveryResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; reason: string; retryable: boolean };

export interface DeliveryAdapter {
  deliver(messageId: string): Promise<DeliveryResult>;
}

export interface OutboxStore {
  claim(limit: number, workerId: string, leaseMs: number): Promise<readonly OutboxDelivery[]>;
  markDelivered(outboxId: string, providerMessageId: string): Promise<void>;
  markRetry(outboxId: string, reason: string, nextAttemptAt: Date): Promise<void>;
  markDead(outboxId: string, reason: string): Promise<void>;
}

export interface OutboxRunSummary {
  claimed: number;
  delivered: number;
  retrying: number;
  dead: number;
}
