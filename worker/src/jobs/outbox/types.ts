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
  workerId: string;
  leaseToken: string;
}

export type DeliveryResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; reason: string; retryable: boolean };

export interface DeliveryAdapter {
  deliver(delivery: OutboxDelivery): Promise<DeliveryResult>;
}

export interface OutboxStore {
  claim(limit: number, workerId: string, leaseMs: number): Promise<readonly OutboxDelivery[]>;
  markDeliveryStarted(delivery: OutboxDelivery): Promise<void>;
  markDelivered(delivery: OutboxDelivery, providerMessageId: string): Promise<void>;
  markRetry(delivery: OutboxDelivery, reason: string, nextAttemptAt: Date): Promise<void>;
  markDead(delivery: OutboxDelivery, reason: string): Promise<void>;
}

export interface OutboxRunSummary {
  claimed: number;
  delivered: number;
  retrying: number;
  dead: number;
}
