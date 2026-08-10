/**
 * 야간 배치의 Supabase 어댑터 — `MetricsSource`/`MetricsSink` 구현. (C4 · T04)
 *
 * ⚠ service_role 키를 쓴다. 이 모듈은 **서버(cron route)에서만** import 한다.
 *    키는 `SUPABASE_SERVICE_ROLE_KEY` 환경변수로만 주입하며 저장소에 두지 않는다.
 *    `NEXT_PUBLIC_` 접두사를 붙이면 브라우저로 유출되므로 절대 사용하지 않는다.
 *
 * 왜 service_role 인가: 배치는 전 조직을 훑어야 하는데 anon/authenticated 키로는
 * tenant RLS 에 막힌다. 대신 **배치만** 이 권한을 갖고, 결과는 집계 수치만
 * `platform_metrics_daily` 에 남긴다(개인정보·원문 미저장). 콘솔은 그 표만 읽는다.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MetricsSink, MetricsSource } from "./batch";
import type { ActivityEvent, DailyRollup } from "./types";

/** 배치용 환경변수가 모두 있는가. 없으면 cron 은 501 로 응답한다. */
export function hasBatchEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

/** service_role 클라이언트. 세션을 유지하지 않는다(배치는 stateless). */
export function createBatchClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "배치 환경변수 누락: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function fail(context: string, error: { message: string } | null): void {
  if (error) throw new Error(`${context}: ${error.message}`);
}

export class SupabaseMetricsSource implements MetricsSource {
  constructor(private readonly db: SupabaseClient) {}

  async listOrgIds(): Promise<string[]> {
    const { data, error } = await this.db.from("orgs").select("id");
    fail("조직 목록 조회 실패", error);
    return (data ?? []).map((r) => String(r.id));
  }

  async listMemberIds(orgId: string): Promise<string[]> {
    const { data, error } = await this.db
      .from("org_members")
      .select("user_id")
      .eq("org_id", orgId);
    fail("멤버 목록 조회 실패", error);
    return (data ?? [])
      .map((r) => (r.user_id === null ? null : String(r.user_id)))
      .filter((v): v is string => v !== null);
  }

  /** activities(org_id, actor, at) → ActivityEvent. 반열린 구간 [from, to). */
  async listEvents(orgId: string, fromIso: string, toIso: string): Promise<ActivityEvent[]> {
    const { data, error } = await this.db
      .from("activities")
      .select("org_id, actor, at")
      .eq("org_id", orgId)
      .gte("at", fromIso)
      .lt("at", toIso);
    fail("활동 조회 실패", error);
    return (data ?? []).map((r) => ({
      orgId: String(r.org_id),
      actorId: r.actor === null ? null : String(r.actor),
      at: String(r.at),
    }));
  }

  async listDealCreatedAts(orgId: string, fromIso: string, toIso: string): Promise<string[]> {
    const { data, error } = await this.db
      .from("deals")
      .select("created_at")
      .eq("org_id", orgId)
      .gte("created_at", fromIso)
      .lt("created_at", toIso);
    fail("딜 조회 실패", error);
    return (data ?? []).map((r) => String(r.created_at));
  }
}

/** 014 의 멱등 upsert RPC 를 호출한다(같은 day+org 재실행 시 덮어쓰기). */
export class SupabaseMetricsSink implements MetricsSink {
  constructor(private readonly db: SupabaseClient) {}

  async upsert(row: DailyRollup): Promise<void> {
    const { error } = await this.db.rpc("upsert_platform_metrics_daily", {
      p_day: row.day,
      p_org_id: row.orgId,
      p_dau: row.dau,
      p_mau: row.mau,
      p_stickiness: row.stickiness,
      p_active_users: row.activeUsers,
      p_dormant_users: row.dormantUsers,
      p_new_deals: row.newDeals,
    });
    fail("지표 적재 실패", error);
  }
}
