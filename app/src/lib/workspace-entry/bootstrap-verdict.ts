import { after } from "next/server";
import type { BootstrapOutcome } from "./bootstrap";

/**
 * Issue 857 — 기본 탭 점검(bootstrap)을 화면이 기다리지 않게 하는 기억.
 *
 * 점검은 매 요청 돌지만 결과는 거의 늘 «고칠 것 없음» 이다(운영 로그: fast-skip). 그런데도 대표가
 * 화면을 열 때마다 0.6초를 기다렸다. 같은 회사·같은 사람이 최근(10분) 점검을 통과했으면 이번
 * 응답은 기다리지 않고 같은 점검을 응답 «뒤에» 돌린다 — 고칠 것이 생겼으면 그때 고치고 다음
 * 화면부터 보인다. 처음이거나 오래됐거나 실패했으면 지금처럼 화면 앞에서 점검한다(실패 = 화면을 막는다).
 * 이 기억은 점검을 «건너뛰는» 것이지 권한을 주는 것이 아니다 — 세션·권한은 요청마다 따로 확인한다.
 * 한 서버 프로세스 안의 기억이라 재시작하면 처음부터 다시 점검한다.
 */
const VERDICT_TTL_MS = 10 * 60 * 1000;
/** 뒤에서 돌리는 점검도 이 간격보다 자주 돌리지 않는다(같은 사람이 연달아 새로고침할 때). */
const RECHECK_INTERVAL_MS = 60 * 1000;

const verdicts = new Map<string, number>();

function keyOf(orgId: string, userId: string): string {
  return `${orgId}:${userId}`;
}

export function hasRecentCleanBootstrap(orgId: string, userId: string, now = Date.now()): boolean {
  const at = verdicts.get(keyOf(orgId, userId));
  return at !== undefined && now - at < VERDICT_TTL_MS;
}

/** 점검이 끝났다 — repaired 도 «이제 깨끗함», skipped(승인된 만든이 아님)는 고칠 일이 없다. */
export function markBootstrapChecked(orgId: string, userId: string, now = Date.now()): void {
  verdicts.set(keyOf(orgId, userId), now);
}

export function forgetBootstrapOutcome(orgId: string, userId: string): void {
  verdicts.delete(keyOf(orgId, userId));
}

/**
 * 최근 통과한 점검을 응답 뒤로 미룬다. 미룬 점검이 실패하면 기억을 지워 다음 화면에서 앞에서 다시 점검한다.
 * 요청 밖(시험 등)이라 미룰 곳이 없으면 false — 호출부가 지금 점검한다.
 */
export function deferBootstrapCheck(
  orgId: string,
  userId: string,
  check: () => Promise<BootstrapOutcome>,
  now = Date.now(),
): boolean {
  const at = verdicts.get(keyOf(orgId, userId)) ?? 0;
  if (now - at < RECHECK_INTERVAL_MS) return true;
  try {
    after(async () => {
      try {
        await check();
        markBootstrapChecked(orgId, userId);
      } catch {
        forgetBootstrapOutcome(orgId, userId);
      }
    });
    return true;
  } catch {
    return false;
  }
}
