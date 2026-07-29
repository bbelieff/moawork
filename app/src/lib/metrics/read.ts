/**
 * 지표 스냅샷 조회 — `platform_metrics_daily` 읽기 전용 계층. (C4 · T04)
 *
 * 권한: **RLS 가 게이트한다.** 014 의 `platform_metrics_daily_read` 정책이
 * `app_admin_role(auth.jwt()->>'email') is not null` 을 요구하므로, 로그인 세션 키
 * (anon + 쿠키)로 조회하면 플랫폼 관리자에게만 행이 보인다.
 * → 읽기에는 service_role 이 **필요 없다**. 배치만 그 권한을 쓴다.
 *
 * 미연결/오류를 데이터 없음으로 위장하지 않는다 — `status` 로 구분해 화면이
 * "아직 집계 안 됨"과 "불러오지 못함"을 다르게 말할 수 있게 한다.
 */

import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import type { DailyRollup } from "./types";

/** 조회 결과 — 실패를 빈 배열로 감추지 않는다. */
export type MetricsSnapshot =
  | { status: "ok"; rows: DailyRollup[] }
  /** Supabase 미연결(로컬 개발). 플랫폼 지표는 실DB 산물이라 폴백하지 않는다. */
  | { status: "not_configured"; rows: [] }
  /** 조회 실패(네트워크·권한). 사유를 화면에 노출한다. */
  | { status: "error"; rows: []; message: string };

interface MetricsRow {
  day: string;
  org_id: string;
  dau: number;
  mau: number;
  stickiness: number | string;
  active_users: number;
  dormant_users: number;
  new_deals: number;
}

/** DB numeric 은 문자열로 올 수 있다 — 숫자로 정규화한다. */
function toNumber(v: number | string | null | undefined): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toRollup(r: MetricsRow): DailyRollup {
  return {
    day: String(r.day),
    orgId: String(r.org_id),
    dau: toNumber(r.dau),
    mau: toNumber(r.mau),
    stickiness: toNumber(r.stickiness),
    activeUsers: toNumber(r.active_users),
    dormantUsers: toNumber(r.dormant_users),
    newDeals: toNumber(r.new_deals),
  };
}

/**
 * 최근 N일 스냅샷(전 조직). 최신 날짜부터 내려온다.
 *
 * `days` 는 **날짜 수**가 아니라 조회 행 수 상한을 결정한다 —
 * 조직 수를 알 수 없으므로 넉넉히 잡고 화면에서 날짜별로 묶는다.
 */
export async function readRecentMetrics(
  days = 14,
  maxRows = 1000,
): Promise<MetricsSnapshot> {
  if (!hasSupabaseEnv()) return { status: "not_configured", rows: [] };

  try {
    const db = await createClient();
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const { data, error } = await db
      .from("platform_metrics_daily")
      .select("day, org_id, dau, mau, stickiness, active_users, dormant_users, new_deals")
      .gte("day", since)
      .order("day", { ascending: false })
      .limit(maxRows);

    if (error) return { status: "error", rows: [], message: error.message };
    return { status: "ok", rows: (data ?? []).map((r) => toRollup(r as MetricsRow)) };
  } catch (err) {
    return {
      status: "error",
      rows: [],
      message: err instanceof Error ? err.message : "지표 조회 실패",
    };
  }
}

/** 날짜별로 묶는다(최신 우선). 화면이 날짜 단위 카드/행을 그릴 때 쓴다. */
export function groupByDay(rows: readonly DailyRollup[]): { day: string; rows: DailyRollup[] }[] {
  const byDay = new Map<string, DailyRollup[]>();
  for (const r of rows) {
    const bag = byDay.get(r.day) ?? [];
    bag.push(r);
    byDay.set(r.day, bag);
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([day, dayRows]) => ({ day, rows: dayRows }));
}
