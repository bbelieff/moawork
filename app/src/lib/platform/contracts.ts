/**
 * Platform A contract seam.
 *
 * This shell intentionally receives aggregate-only metadata.  A later server
 * adapter may populate it, but this UI never assumes a database table, an RPC
 * name, or a customer-data shape.
 */
export type PlatformAggregateState =
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; updatedAt: string | null; values: readonly PlatformAggregateValue[] };

export type PlatformAggregateValue = {
  label: string;
  value: string | null;
  description: string;
};

/** Aggregate-only row returned by migration 016's platform RPC. */
export type PlatformMetricsDailyRow = {
  day: string;
  workspace_count: number;
  dau: number;
  mau: number;
  stickiness: number;
  active_users: number;
  dormant_users: number;
  new_deals: number;
  computed_at: string | null;
};

export type PlatformSectionKey =
  | "overview"
  | "organizations"
  | "billing"
  | "access"
  | "support"
  | "analytics"
  | "system"
  | "admins"
  | "demo";

/** P0-safe default: a missing aggregate source must never become a fake zero. */
export function unavailablePlatformAggregate(): PlatformAggregateState {
  return {
    kind: "unavailable",
    message: "안전한 집계 연결이 아직 준비되지 않았어요. 임시 수치나 고객 정보로 대신 표시하지 않습니다.",
  };
}
