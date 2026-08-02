/**
 * T07 · mod.perf 월 마감 재계산 포트 (설계 §2.4-b).
 *
 * 워커는 **집계 로직을 갖지 않는다.** 계산 정본은 앱의 `app/src/lib/perf`(순수 함수)이며
 * 여기서 다시 구현하면 두 벌이 서로 다르게 흘러가 "배치가 낸 지급액"과 "화면이 보여주는
 * 지급액"이 갈린다. 워커의 책임은 **언제 · 어느 조직 · 어느 달**을 재계산할지 정하고
 * 그 호출을 위임하는 것뿐이다.
 */

/** 재계산 대상 조직 1건. */
export interface RecomputeTarget {
  orgId: string;
}

/** 조직 1건 재계산 결과. */
export interface RecomputeOutcome {
  orgId: string;
  period: string;
  rowCount: number;
}

/** 재계산 대상 조직 목록 제공자. */
export interface OrgLister {
  /** 활성 조직 id 목록. */
  listOrgIds(): Promise<string[]>;
}

/** 실제 재계산 수행자(앱 계층 위임). */
export interface RecomputeRunner {
  recompute(target: RecomputeTarget, period: string): Promise<RecomputeOutcome>;
}

/**
 * 미구현 어댑터 — **의도적으로 아무 조직도 돌려주지 않는다.**
 *
 * mod.notify 의 `pendingLoader` 와 같은 fail-safe 자세다. 배선(앱 재계산 진입점 +
 * 워커용 호출 수단)이 확정되기 전에 배치가 실제 쓰기를 시도하면, 잘못된 범위로
 * 조직 전체 스냅샷을 덮어써 지급액을 망가뜨릴 수 있다. 그래서 큐·스케줄·핸들러는
 * 전부 살아 있되 **대상이 0건**이라 아무것도 바꾸지 않는다.
 *
 * 활성화에 필요한 것(별도 승인 대상):
 *   - 워커가 조직 목록과 정산/딜을 읽을 경로(Supabase 어댑터 또는 전용 RPC)
 *   - 워커 → 앱 재계산 호출의 인증 수단. **사용자 세션을 우회하는 머신 토큰은
 *     P0 AuthZ 계약(§10 이중 방어)상 임의로 만들지 않는다** — belie 승인 필요.
 */
export const pendingOrgLister: OrgLister = {
  async listOrgIds() {
    return [];
  },
};

export const pendingRecomputeRunner: RecomputeRunner = {
  async recompute(target, period) {
    console.warn(
      `[perf] 재계산 어댑터 미구현 — 건너뜀 orgId=${target.orgId} period=${period}`,
    );
    return { orgId: target.orgId, period, rowCount: 0 };
  },
};
