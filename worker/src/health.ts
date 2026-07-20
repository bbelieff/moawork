export interface HealthStatus {
  ok: boolean;
  service: string;
  ts: string;
}

/** 워커의 상태 스냅샷을 반환한다. */
export function health(now: Date = new Date()): HealthStatus {
  return {
    ok: true,
    service: "moawork-worker",
    ts: now.toISOString(),
  };
}
