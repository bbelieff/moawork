/**
 * Platform metrics rollup boundary.
 *
 * This worker never reads or returns tenant payloads.  It only accepts a
 * pre-authorized aggregate-day executor supplied by the deployment adapter.
 * Until the PostHog Query API, service credential, and cron are all present,
 * it returns an explicit unavailable result instead of manufacturing zeroes.
 */

export const PLATFORM_METRICS_QUEUE = "platform.metrics.rollup";
export const PLATFORM_METRICS_TIME_ZONE = "Asia/Seoul";
export const DEFAULT_RECOMPUTE_DAYS = 3;

export type RollupUnavailableReason =
  | "cron_disabled"
  | "missing_posthog_query_api"
  | "missing_service_role"
  | "missing_executor";

export interface AggregateDayReceipt {
  /** Canonical KST calendar day accepted by the additive schema/RPC contract. */
  day: string;
  /** Number of aggregate snapshot rows upserted; no tenant payload is exposed. */
  upsertedRows: number;
}

export type AggregateDayExecutor = (day: string) => Promise<AggregateDayReceipt>;

export interface PlatformMetricsRollupConfig {
  cronEnabled?: string | undefined;
  posthogQueryApiKey?: string | undefined;
  serviceRoleKey?: string | undefined;
  executeDay?: AggregateDayExecutor | undefined;
  now?: () => Date;
  recomputeDays?: number;
}

export type PlatformMetricsRollupResult =
  | { status: "unavailable"; reason: RollupUnavailableReason; days: string[]; rows: 0 }
  | { status: "completed"; days: string[]; rows: number; failedDays: string[] };

function configured(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

/** Returns an ISO calendar day in the worker's canonical KST time zone. */
export function kstDay(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PLATFORM_METRICS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** KST day values, newest first, never including the current in-progress day. */
export function rollupDays(now: Date, days = DEFAULT_RECOMPUTE_DAYS): string[] {
  if (!Number.isInteger(days) || days < 1 || days > 31) {
    throw new Error("recompute day count must be an integer between 1 and 31");
  }
  const current = kstDay(now);
  const cursor = new Date(`${current}T00:00:00.000Z`);
  return Array.from({ length: days }, (_, index) => {
    const next = new Date(cursor);
    next.setUTCDate(next.getUTCDate() - (index + 1));
    return next.toISOString().slice(0, 10);
  });
}

function unavailable(
  config: PlatformMetricsRollupConfig,
): RollupUnavailableReason | null {
  if (config.cronEnabled !== "true") return "cron_disabled";
  if (!configured(config.posthogQueryApiKey)) return "missing_posthog_query_api";
  if (!configured(config.serviceRoleKey)) return "missing_service_role";
  if (!config.executeDay) return "missing_executor";
  return null;
}

/**
 * Runs a bounded, replay-safe daily aggregate rollup.
 * The executor must be an idempotent upsert supplied by the deployment
 * adapter; this module intentionally has no direct tenant-data query path.
 */
export async function runPlatformMetricsRollup(
  config: PlatformMetricsRollupConfig,
): Promise<PlatformMetricsRollupResult> {
  const days = rollupDays(config.now?.() ?? new Date(), config.recomputeDays);
  const reason = unavailable(config);
  if (reason) return { status: "unavailable", reason, days, rows: 0 };

  const executeDay = config.executeDay!;
  let rows = 0;
  const failedDays: string[] = [];
  for (const day of days) {
    try {
      const receipt = await executeDay(day);
      if (receipt.day !== day || !Number.isSafeInteger(receipt.upsertedRows) || receipt.upsertedRows < 0) {
        throw new Error("invalid aggregate rollup receipt");
      }
      rows += receipt.upsertedRows;
    } catch {
      // Do not turn a failed day into a synthetic zero. The next idempotent
      // run can retry it, while callers receive the explicit failed day.
      failedDays.push(day);
    }
  }
  return { status: "completed", days, rows, failedDays };
}
