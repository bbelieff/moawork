import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  emptyPlatformAggregate,
  notContractedPlatformAggregate,
  unavailablePlatformAggregate,
  type PlatformAggregateCoverage,
  type PlatformAggregateFreshness,
  type PlatformAggregateState,
  type PlatformAggregateUnavailableReason,
  type PlatformAggregateValue,
  type PlatformMetricsDailyRow,
  type PlatformSectionKey,
} from "./contracts";

type RpcRow = Record<string, unknown>;

/** 016 RPC 에 요청하는 날짜 범위(최근 N일). */
export const PLATFORM_METRICS_WINDOW_DAYS = 30;

/**
 * 이 시간을 넘긴 스냅샷은 **stale** 로 표기한다.
 * 롤업이 야간 배치라 하루(24h)는 정상 간격이고, 36h 를 넘겼다는 건 한 번 걸렀다는 뜻이다.
 */
export const PLATFORM_METRICS_STALE_AFTER_HOURS = 36;

/** 집계 계약이 실제로 값을 내주는 섹션. 나머지는 장애가 아니라 계약 밖이다. */
const CONTRACTED_SECTIONS: ReadonlySet<PlatformSectionKey> = new Set([
  "overview",
  "organizations",
  "analytics",
  "system",
]);

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function toMetricsDailyRow(value: RpcRow): PlatformMetricsDailyRow | null {
  const day = textValue(value.day);
  const workspaceCount = numberValue(value.workspace_count);
  const dau = numberValue(value.dau);
  const mau = numberValue(value.mau);
  const stickiness = numberValue(value.stickiness);
  const activeUsers = numberValue(value.active_users);
  const dormantUsers = numberValue(value.dormant_users);
  const newDeals = numberValue(value.new_deals);
  if (!day || workspaceCount === null || dau === null || mau === null || stickiness === null || activeUsers === null || dormantUsers === null || newDeals === null) return null;
  return { day, workspace_count: workspaceCount, dau, mau, stickiness, active_users: activeUsers, dormant_users: dormantUsers, new_deals: newDeals, computed_at: textValue(value.computed_at) };
}

function dayInput(daysBeforeToday: number, asOf: Date): string {
  const date = new Date(asOf.getTime());
  date.setUTCDate(date.getUTCDate() - daysBeforeToday);
  return date.toISOString().slice(0, 10);
}

function numberDisplay(value: number | null): string | null {
  return value === null ? null : new Intl.NumberFormat("ko-KR").format(value);
}

/**
 * 신선도 판정 — **순수 함수**(`asOf` 를 받는다. 내부에서 `new Date()` 를 부르지 않는다).
 * `computed_at` 이 없거나 깨졌으면 신선하다고 단정하지 않고 `unknown` 으로 남긴다.
 */
export function resolveFreshness(
  computedAt: string | null,
  asOf: Date,
  staleAfterHours: number = PLATFORM_METRICS_STALE_AFTER_HOURS,
): PlatformAggregateFreshness {
  if (!computedAt) return { kind: "unknown", computedAt: null };
  const at = Date.parse(computedAt);
  if (!Number.isFinite(at)) return { kind: "unknown", computedAt: null };
  const ageHours = Math.max(0, Math.round(((asOf.getTime() - at) / 3_600_000) * 10) / 10);
  return ageHours > staleAfterHours
    ? { kind: "stale", computedAt, ageHours, staleAfterHours }
    : { kind: "fresh", computedAt, ageHours, staleAfterHours };
}

/** 충족도 — 버린 행 수를 남긴다. 조용한 드롭이 곧 과장이다. */
export function buildCoverage(
  requestedDays: number,
  receivedRows: number,
  usableRows: number,
): PlatformAggregateCoverage {
  const droppedRows = Math.max(0, receivedRows - usableRows);
  return { requestedDays, receivedRows, usableRows, droppedRows, partial: droppedRows > 0 };
}

/** Supabase 오류 코드 → 사유. 권한 거부와 미배포와 일시 실패를 섞지 않는다. */
export function unavailableReasonFromRpcError(
  error: { code?: string | null } | null | undefined,
): PlatformAggregateUnavailableReason {
  const code = error?.code ?? "";
  // 42501 = insufficient_privilege. 016 의 platform_console_require_operator() 가 던진다.
  if (code === "42501") return "denied";
  // 42883 = undefined_function · PGRST202 = PostgREST 가 RPC 를 못 찾음 → 016 미배포.
  if (code === "42883" || code === "PGRST202") return "not-configured";
  return "failed";
}

type SectionAggregate = {
  values: PlatformAggregateValue[];
  /** true zero 판정에 쓰는 원시 수치. 날짜·비율 표시는 제외한다. */
  numerics: number[];
};

function sectionAggregate(
  section: PlatformSectionKey,
  latest: PlatformMetricsDailyRow,
  rows: readonly PlatformMetricsDailyRow[],
): SectionAggregate | null {
  if (section === "overview") {
    return {
      values: [
        { label: "워크스페이스", value: numberDisplay(latest.workspace_count), description: `${latest.day} 기준 집계` },
        { label: "활성 사용자", value: numberDisplay(latest.active_users), description: "개인 식별 정보 없이 합산" },
        { label: "새 진행 업무", value: numberDisplay(latest.new_deals), description: "제목·고객 정보 없이 합산" },
      ],
      numerics: [latest.workspace_count, latest.active_users, latest.new_deals],
    };
  }
  if (section === "organizations") {
    return {
      values: [
        { label: "연결된 워크스페이스", value: numberDisplay(latest.workspace_count), description: "이름과 구성원 목록은 표시하지 않아요." },
      ],
      numerics: [latest.workspace_count],
    };
  }
  if (section === "analytics") {
    return {
      values: [
        { label: "최근 집계일", value: latest.day, description: `${rows.length}일 범위의 일별 집계` },
        { label: "일일 활성", value: numberDisplay(latest.dau), description: "최근 집계일 기준" },
        { label: "월간 활성", value: numberDisplay(latest.mau), description: "최근 집계일 기준" },
        { label: "활성 비율", value: `${Math.round(latest.stickiness * 100)}%`, description: "일일 활성 ÷ 월간 활성" },
      ],
      numerics: [latest.dau, latest.mau],
    };
  }
  if (section === "system") {
    return {
      values: [
        { label: "마지막 집계", value: latest.computed_at ?? latest.day, description: "집계가 계산된 시각 또는 기준일" },
        { label: "집계 범위", value: `${rows.length}일`, description: `최근 ${PLATFORM_METRICS_WINDOW_DAYS}일 범위에서 읽었어요.` },
      ],
      // 날짜·범위만 보여주는 섹션이라 "진짜 0" 개념이 없다.
      numerics: [],
    };
  }
  return null;
}

export type PlatformAggregateOptions = {
  /** 신선도 기준 시각. 호출부가 주입한다(테스트 재현성). */
  asOf: Date;
  /** 조회를 요청한 날짜 수. */
  requestedDays: number;
  /** RPC 가 돌려준 행 수(형식 검증 전). `rows.length` 와 다르면 partial 이다. */
  receivedRows: number;
  staleAfterHours?: number;
};

/**
 * RPC 결과 → 화면 상태. **순수 함수**다.
 *
 * 판정 순서가 곧 계약이다.
 *  1. 계약 밖 섹션 → `not-contracted` (장애 아님)
 *  2. 행을 받았는데 쓸 수 있는 게 하나도 없음 → `unavailable(malformed)` (0건으로 위장 금지)
 *  3. 받은 것도 0건 → `empty` (값이 0이라는 뜻 아님)
 *  4. 그 외 → `ready` + 신선도/충족도/진짜 0 표기
 */
export function toPlatformAggregate(
  section: PlatformSectionKey,
  rows: readonly PlatformMetricsDailyRow[],
  options: PlatformAggregateOptions,
): PlatformAggregateState {
  if (!CONTRACTED_SECTIONS.has(section)) return notContractedPlatformAggregate();

  const coverage = buildCoverage(options.requestedDays, options.receivedRows, rows.length);
  if (rows.length === 0) {
    return options.receivedRows > 0
      ? unavailablePlatformAggregate("malformed")
      : emptyPlatformAggregate(coverage);
  }

  const latest = rows.at(-1)!;
  const aggregate = sectionAggregate(section, latest, rows);
  if (!aggregate) return notContractedPlatformAggregate();

  return {
    kind: "ready",
    updatedAt: latest.computed_at ?? latest.day,
    values: aggregate.values,
    freshness: resolveFreshness(latest.computed_at, options.asOf, options.staleAfterHours),
    coverage,
    allZero: aggregate.numerics.length > 0 && aggregate.numerics.every((n) => n === 0),
  };
}

/** The page guard runs first; this loader only calls migration 016's aggregate RPC. */
export async function loadPlatformAggregate(
  section: PlatformSectionKey,
  asOf: Date = new Date(),
): Promise<PlatformAggregateState> {
  if (!CONTRACTED_SECTIONS.has(section)) return notContractedPlatformAggregate();
  // 미연결을 "조회 실패"로 말하지 않는다 — 운영 미완과 장애는 다른 사건이다.
  if (!hasSupabaseEnv()) return unavailablePlatformAggregate("not-configured");

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("platform_console_metrics_daily", {
      p_from: dayInput(PLATFORM_METRICS_WINDOW_DAYS - 1, asOf),
      p_to: dayInput(0, asOf),
    });
    if (error) return unavailablePlatformAggregate(unavailableReasonFromRpcError(error));
    if (!Array.isArray(data)) return unavailablePlatformAggregate("malformed");

    const rows = data
      .map((row) => toMetricsDailyRow(row as RpcRow))
      .filter((row): row is PlatformMetricsDailyRow => row !== null);
    return toPlatformAggregate(section, rows, {
      asOf,
      requestedDays: PLATFORM_METRICS_WINDOW_DAYS,
      receivedRows: data.length,
    });
  } catch {
    return unavailablePlatformAggregate("failed");
  }
}
