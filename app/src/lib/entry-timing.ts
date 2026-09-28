/**
 * Coarse server-side stage timings for workspace entry.
 *
 * Emits ONE console.info JSON line per measured scope with stage names and
 * durations only — never IDs, usernames, slugs, cookies, or values — so
 * production logs reveal the bottleneck without leaking tenant data.
 */
export type EntryStageTiming = { stage: string; ms: number };

export function createEntryTimer(): {
  time<T>(stage: string, fn: () => PromiseLike<T>): Promise<T>;
  snapshot(): EntryStageTiming[];
} {
  const stages: EntryStageTiming[] = [];
  return {
    async time(stage, fn) {
      const start = performance.now();
      try {
        return await fn();
      } finally {
        stages.push({ stage, ms: Math.round((performance.now() - start) * 10) / 10 });
      }
    },
    snapshot() {
      return [...stages];
    },
  };
}

export type EntryTimingOutcome = "fast-skip" | "repaired" | "ready" | "unavailable";

export function logEntryTimings(
  scope: "workspace-bootstrap" | "workspace-layout",
  stages: EntryStageTiming[],
  outcome: EntryTimingOutcome,
): void {
  console.info(JSON.stringify({ mw_entry_timing: true, scope, outcome, stages }));
}
