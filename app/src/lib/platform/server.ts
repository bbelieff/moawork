// T07 · 플랫폼 콘솔 서버 데이터 계층.
//
// 008 의 SECURITY DEFINER RPC 만 호출한다. 테이블 직접 select 는 하지 않는다
// (특히 `app_admins` — RLS 로 막혀 있어 0건이 나온다).
//
// 반환 파싱은 전부 방어적이다: RPC 가 예상 밖 형태를 주면 빈 값으로 수렴시키고
// 화면은 0/'—' 를 표시한다(빈 화면·NaN 금지).

import { createClient } from "@/lib/supabase/server";
import { parseAdminLevel } from "./access";
import type {
  AdminEntry,
  AdminLevel,
  BillingMonthRow,
  MetricsDailyRow,
  OrgOverviewRow,
  TtfvInput,
} from "./types";

/** RPC 호출 표면만 추린 클라이언트 — 테스트에서 가짜 구현을 넣기 쉽게 한다. */
export interface PlatformRpcClient {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): Promise<{ data: unknown; error: unknown }>;
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    : [];
}

function text(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(row: Record<string, unknown>, key: string): number {
  const v = row[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  // Postgres numeric 은 문자열로 오는 경우가 있다.
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function bool(row: Record<string, unknown>, key: string): boolean {
  return row[key] === true;
}

/** 현재 세션의 운영 등급. 관리자가 아니면 null. */
export async function getAdminLevel(
  client: PlatformRpcClient,
): Promise<AdminLevel | null> {
  const { data, error } = await client.rpc("platform_admin_level");
  if (error) return null;
  return parseAdminLevel(data);
}

export async function listOrgOverview(
  client: PlatformRpcClient,
  includeInternal = false,
): Promise<OrgOverviewRow[]> {
  const { data, error } = await client.rpc("platform_org_overview", {
    p_include_internal: includeInternal,
  });
  if (error) return [];
  return rows(data).map((r) => ({
    orgId: text(r, "org_id") ?? "",
    name: text(r, "name") ?? "(이름 없음)",
    planTier: text(r, "plan_tier") ?? "",
    isInternal: bool(r, "is_internal"),
    createdAt: text(r, "created_at") ?? "",
    memberCount: num(r, "member_count"),
    activeUsers7d: num(r, "active_users_7d"),
    writes7d: num(r, "writes_7d"),
    errors7d: num(r, "errors_7d"),
    lastActivityAt: text(r, "last_activity_at"),
  }));
}

export async function listMetricsRange(
  client: PlatformRpcClient,
  from: string,
  to: string,
  includeInternal = false,
): Promise<MetricsDailyRow[]> {
  const { data, error } = await client.rpc("platform_metrics_range", {
    p_from: from,
    p_to: to,
    p_include_internal: includeInternal,
  });
  if (error) return [];
  return rows(data).map((r) => ({
    // date 는 'YYYY-MM-DD' 로 온다. 타임스탬프가 섞여 와도 앞 10자만 쓴다.
    date: (text(r, "date") ?? "").slice(0, 10),
    orgId: text(r, "org_id") ?? "",
    activeUsers: num(r, "active_users"),
    writes: num(r, "writes"),
    errors: num(r, "errors"),
    memberCount: num(r, "member_count"),
  }));
}

export async function listTtfv(
  client: PlatformRpcClient,
  includeInternal = false,
): Promise<TtfvInput[]> {
  const { data, error } = await client.rpc("platform_ttfv", {
    p_include_internal: includeInternal,
  });
  if (error) return [];
  return rows(data).map((r) => ({
    orgId: text(r, "org_id") ?? "",
    name: text(r, "name") ?? "",
    signedUpAt: text(r, "signed_up_at") ?? "",
    firstDealAt: text(r, "first_deal_at"),
  }));
}

export async function listAdmins(
  client: PlatformRpcClient,
): Promise<AdminEntry[]> {
  const { data, error } = await client.rpc("platform_admin_list");
  if (error) return [];
  return rows(data).flatMap((r) => {
    const email = text(r, "email");
    const level = parseAdminLevel(r.level);
    if (!email || !level) return [];
    return [
      {
        email,
        level,
        isPlatform: bool(r, "is_platform"),
        addedBy: text(r, "added_by"),
        revokedAt: text(r, "revoked_at"),
        lastSeenAt: text(r, "last_seen_at"),
        createdAt: text(r, "created_at") ?? "",
      },
    ];
  });
}

export async function listBillingMonthly(
  client: PlatformRpcClient,
  months = 12,
): Promise<BillingMonthRow[]> {
  const { data, error } = await client.rpc("platform_billing_monthly", {
    p_months: months,
  });
  if (error) return [];
  return rows(data).map((r) => ({
    month: (text(r, "month") ?? "").slice(0, 10),
    invoiceCount: num(r, "invoice_count"),
    supplySum: num(r, "supply_sum"),
    vatSum: num(r, "vat_sum"),
    totalSum: num(r, "total_sum"),
    paidSum: num(r, "paid_sum"),
  }));
}

/** 콘솔 진입 흔적. 실패해도 화면을 막지 않는다(부가 기능). */
export async function touchLastSeen(client: PlatformRpcClient): Promise<void> {
  try {
    await client.rpc("platform_touch_last_seen");
  } catch {
    // 무시 — 접속 기록 실패로 콘솔을 못 쓰게 만들 이유가 없다.
  }
}

/** 실제 Supabase 클라이언트로 등급을 조회한다(서버 컴포넌트용). */
export async function loadAdminLevel(): Promise<AdminLevel | null> {
  const supabase = (await createClient()) as unknown as PlatformRpcClient;
  return getAdminLevel(supabase);
}

/** 서버 컴포넌트에서 쓸 RPC 클라이언트. */
export async function platformClient(): Promise<PlatformRpcClient> {
  return (await createClient()) as unknown as PlatformRpcClient;
}
