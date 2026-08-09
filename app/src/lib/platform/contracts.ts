/**
 * Platform A contract seam.
 *
 * This shell intentionally receives aggregate-only metadata.  A later server
 * adapter may populate it, but this UI never assumes a database table, an RPC
 * name, or a customer-data shape.
 *
 * ── 상태를 왜 이렇게 잘게 나누나 (BBE-12) ──
 * 예전 계약은 `ready | unavailable` 둘뿐이라 아래가 전부 한 덩어리로 뭉쳐졌다.
 *   - 집계 행이 0건인 것(**empty**) → "연결 안 됨"으로 표기됐다
 *   - 며칠 지난 스냅샷(**stale**) → 방금 계산된 값처럼 `ready` 로 보였다
 *   - 일부 행만 형식이 맞은 것(**partial**) → 조용히 버려져 티가 안 났다
 *   - 집계는 정상이고 값이 진짜 0인 것(**true zero**) → empty 와 구분되지 않았다
 *   - 권한 거부·미배포·조회 실패(**unavailable**) → 사유가 같은 문구였다
 * 그 결과 화면이 **실제 인프라 상태가 아닌 것을 "시스템 상태"로 과장**했다.
 * 여기서 상태를 나누고, 화면은 각 상태를 다른 문구로 말한다.
 */
export type PlatformAggregateState =
  /** 조회 자체가 성립하지 않았다. 사유를 반드시 구분해 말한다. */
  | { kind: "unavailable"; reason: PlatformAggregateUnavailableReason; message: string }
  /** 이 섹션은 집계 계약 밖이다(장애가 아니다). */
  | { kind: "not-contracted"; message: string }
  /** 조회는 됐고 범위 안에 집계 행이 0건이다. **값이 0이라는 뜻이 아니다.** */
  | { kind: "empty"; message: string; coverage: PlatformAggregateCoverage }
  /** 표시할 집계가 있다. 신선도·충족도·진짜 0 여부를 함께 들고 간다. */
  | {
      kind: "ready";
      updatedAt: string | null;
      values: readonly PlatformAggregateValue[];
      freshness: PlatformAggregateFreshness;
      coverage: PlatformAggregateCoverage;
      /** 계약된 수치가 전부 0 — 집계는 돌았고 값이 진짜 0이다(empty 와 다르다). */
      allZero: boolean;
    };

export type PlatformAggregateValue = {
  label: string;
  value: string | null;
  description: string;
};

/**
 * 신선도. `computed_at` 이 없거나 파싱 불가면 **"모른다"** 고 말한다 —
 * 신선하다고 단정하는 순간 그게 곧 상태 과장이다.
 */
export type PlatformAggregateFreshness =
  | { kind: "fresh"; computedAt: string; ageHours: number; staleAfterHours: number }
  | { kind: "stale"; computedAt: string; ageHours: number; staleAfterHours: number }
  | { kind: "unknown"; computedAt: null };

/** 요청한 범위 대비 실제로 쓸 수 있었던 행. 드롭을 숨기지 않는다. */
export type PlatformAggregateCoverage = {
  /** 조회를 요청한 날짜 수. */
  requestedDays: number;
  /** RPC 가 돌려준 행 수. */
  receivedRows: number;
  /** 계약 형태를 만족해 실제로 쓴 행 수. */
  usableRows: number;
  /** 형식 불일치로 버린 행 수. */
  droppedRows: number;
  /** 버려진 행이 있는가. */
  partial: boolean;
};

/**
 * 조회 실패 사유.
 * - `not-configured` — Supabase 미연결 또는 016 RPC 미배포(운영 미완)
 * - `denied`         — 로그인은 됐지만 플랫폼 운영자가 아님(42501)
 * - `malformed`      — 행은 왔는데 집계 계약 형태가 아님
 * - `failed`         — 그 밖의 조회 실패(네트워크·일시 장애)
 */
export type PlatformAggregateUnavailableReason =
  | "not-configured"
  | "denied"
  | "malformed"
  | "failed";

/** 사유별 문구. 원인 문자열(DB 오류 원문)은 화면에 싣지 않는다 — 스키마 노출 금지. */
export const PLATFORM_AGGREGATE_UNAVAILABLE_COPY: Record<
  PlatformAggregateUnavailableReason,
  string
> = {
  "not-configured":
    "안전한 집계 연결이 아직 준비되지 않았어요. 임시 수치나 고객 정보로 대신 표시하지 않습니다.",
  denied:
    "이 계정에는 운영 집계를 읽을 권한이 없어요. 권한 문제이지 집계가 비어 있다는 뜻은 아니에요.",
  malformed:
    "집계 응답이 약속한 형태가 아니라 표시하지 않았어요. 값을 추측해 채우지 않습니다.",
  failed:
    "집계를 불러오지 못했어요. 일시적인 조회 실패이지 값이 0이라는 뜻은 아니에요.",
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
export function unavailablePlatformAggregate(
  reason: PlatformAggregateUnavailableReason = "not-configured",
): PlatformAggregateState {
  return {
    kind: "unavailable",
    reason,
    message: PLATFORM_AGGREGATE_UNAVAILABLE_COPY[reason],
  };
}

/** 집계는 읽혔고 범위 안에 행이 없다 — 장애가 아니라 "아직 없음"이다. */
export function emptyPlatformAggregate(
  coverage: PlatformAggregateCoverage,
): PlatformAggregateState {
  return {
    kind: "empty",
    coverage,
    message:
      "집계 스냅샷이 아직 없어요. 값이 0이라는 뜻으로 바꾸어 보여주지 않아요.",
  };
}

/** 집계 계약에 포함되지 않은 섹션 — 인프라 상태와 무관하다. */
export function notContractedPlatformAggregate(): PlatformAggregateState {
  return {
    kind: "not-contracted",
    message:
      "이 영역은 현재 집계 전용 계약에 포함되지 않아요. 고객·개인·결제 원문이나 운영 권한을 대신 표시하지 않아요.",
  };
}
