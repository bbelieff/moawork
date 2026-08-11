import "server-only";

import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { Ctx } from "@/lib/types";
import { bellBadge, sidebarBadges } from "./badge";
import { groupFeed, type FeedGroup } from "./grouping";
import { deepLink, feedLine, type FeedLine } from "./messages";
import type { BadgeState, FeedItem, Notification, SurfaceKey, SurfaceSeen } from "./types";
import { routeNotificationFeed, type NotificationRecipient, type NotificationRoutingPort } from "./recipients";
import {
  myNotificationsFor,
  orgFeedFor,
  surfaceOfFeedItem,
  surfaceOfNotification,
  type ScopeContext,
} from "./visibility";

/** 패널 1회 로드 분량. 무한 스크롤 대신 [전체 보기] 로 넘긴다. */
const PAGE_SIZE = 30;

export interface NotifySnapshot {
  bell: BadgeState;
  sidebar: Record<SurfaceKey, BadgeState>;
  mine: Array<{ notification: Notification; href: string | null }>;
  org: Array<{ group: FeedGroup; line: FeedLine; href: string | null; recipient: NotificationRecipient }>;
}

export const EMPTY_SNAPSHOT: NotifySnapshot = {
  bell: { kind: "none" },
  sidebar: {},
  mine: [],
  org: [],
};

/**
 * 알림 스냅샷 로드.
 *
 * Supabase 미설정(로컬 골격)에서는 빈 스냅샷을 반환한다 — 벨은 조용히 비어 있고
 * 오류 팝업을 띄우지 않는다.
 */
export async function loadNotifySnapshot(ctx: Ctx, now = new Date(), routingPort?: NotificationRoutingPort): Promise<NotifySnapshot> {
  if (!hasSupabaseEnv()) return EMPTY_SNAPSHOT;

  try {
    const supabase = await createClient();

    const [notifRes, feedRes, seenRes] = await Promise.all([
      supabase
        .from("notifications")
        .select("*")
        .eq("org_id", ctx.org.id)
        .eq("user_id", ctx.user.id)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE),
      supabase
        .from("audit_logs")
        .select("id, org_id, actor, action, target_type, target_id, at")
        .eq("org_id", ctx.org.id)
        .order("at", { ascending: false })
        .limit(PAGE_SIZE * 2),
      supabase
        .from("notification_surface_seen")
        .select("surface_key, seen_at")
        .eq("org_id", ctx.org.id)
        .eq("user_id", ctx.user.id),
    ]);

    // 조회 실패는 조용히 빈 값으로 — 알림 때문에 화면 전체가 죽으면 안 된다.
    const rawNotifications = (notifRes.data ?? []) as Notification[];
    const rawFeed = (feedRes.data ?? []) as FeedItem[];
    const seen = (seenRes.data ?? []) as SurfaceSeen[];

    const scopeCtx = await buildScopeContext(ctx, supabase);

    // RLS 가 1차 방어선이지만 앱에서도 같은 규칙을 다시 적용한다(다중 방어).
    const mine = myNotificationsFor(rawNotifications, ctx.org.id, ctx.user.id);
    const feed = orgFeedFor(rawFeed, ctx.org.id, scopeCtx);
    const routedFeed = await routeFeedToCurrentUser(feed, ctx, routingPort ?? new CurrentMainRoutingPort(ctx.org.id, supabase));

    const actorNames = await loadActorNames(feed, mine, supabase);

    return {
      bell: bellBadge(mine),
      sidebar: sidebarBadges(mine, routedFeed.map((item) => item.feed), seen, surfaceOfNotification, surfaceOfFeedItem),
      mine: mine.map((notification) => ({
        notification,
        href: deepLink(notification.target_type, notification.target_id),
      })),
      org: groupFeed(routedFeed.map((item) => item.feed)).map((group) => ({
        group,
        line: feedLine(group.head, actorNames.get(group.head.actor ?? "") ?? null, now, group.count),
        href: deepLink(group.head.target_type, group.head.target_id),
        recipient: routedFeed.find((item) => item.feed.id === group.head.id)!.recipient,
      })),
    };
  } catch {
    // 네트워크·권한 오류로 알림이 안 뜨는 것은 감수하되, 화면은 계속 동작해야 한다.
    return EMPTY_SNAPSHOT;
  }
}

async function routeFeedToCurrentUser(
  feed: readonly FeedItem[],
  ctx: Ctx,
  port: NotificationRoutingPort,
): Promise<Array<{ feed: FeedItem; recipient: NotificationRecipient }>> {
  const routes = await port.load(feed.flatMap((item) => item.target_id ? [item.target_id] : []));
  return routeNotificationFeed(feed, ctx.user.id, routes, ctx.scope === "all");
}

class CurrentMainRoutingPort implements NotificationRoutingPort {
  constructor(private orgId: string, private supabase: Awaited<ReturnType<typeof createClient>>) {}
  async load(targetIds: readonly string[]) {
    const [{ data: members }, { data: deals }] = await Promise.all([
      this.supabase.from("org_members").select("user_id").eq("org_id", this.orgId).eq("status", "active"),
      targetIds.length ? this.supabase.from("deals").select("id, assigned_to").eq("org_id", this.orgId).in("id", targetIds) : Promise.resolve({ data: [] }),
    ]);
    const teamMembers = (members ?? []).map((row: { user_id: string }) => row.user_id);
    const routes = new Map<string, { assigneeId: string | null; teamMembers: string[] }>(
      [["*", { assigneeId: null, teamMembers }], ...targetIds.map((id) => [id, { assigneeId: null, teamMembers }] as const)],
    );
    for (const row of (deals ?? []) as Array<{ id: string; assigned_to: string | null }>) {
      routes.set(row.id, { assigneeId: row.assigned_to, teamMembers });
    }
    return routes;
  }
}


/** 담당범위 판정에 필요한 '내 담당 딜' 집합을 만든다. */
async function buildScopeContext(
  ctx: Ctx,
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<ScopeContext> {
  if (ctx.scope === "all") {
    return { scope: "all", userId: ctx.user.id, assignedDealIds: new Set() };
  }
  const { data } = await supabase
    .from("deals")
    .select("id")
    .eq("org_id", ctx.org.id)
    .eq("assigned_to", ctx.user.id);

  return {
    scope: "assigned",
    userId: ctx.user.id,
    assignedDealIds: new Set((data ?? []).map((d: { id: string }) => d.id)),
  };
}

/** 주어 표시용 이름. 이름 외 개인정보(이메일 등)는 가져오지 않는다. */
async function loadActorNames(
  feed: readonly FeedItem[],
  mine: readonly Notification[],
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<Map<string, string | null>> {
  const ids = new Set<string>();
  for (const f of feed) if (f.actor) ids.add(f.actor);
  for (const n of mine) if (n.actor_id) ids.add(n.actor_id);
  if (ids.size === 0) return new Map();

  const { data } = await supabase.from("users").select("id, name").in("id", [...ids]);
  return new Map((data ?? []).map((u: { id: string; name: string | null }) => [u.id, u.name]));
}

/**
 * "모두 읽음" — 점만 지운다.
 * ★ resolved_at 은 건드리지 않으므로 숫자(할 일)는 그대로 남는다.
 */
export async function markAllRead(ctx: Ctx, now = new Date()): Promise<void> {
  if (!hasSupabaseEnv()) return;
  const supabase = await createClient();
  const stamp = now.toISOString();

  await supabase
    .from("notifications")
    .update({ read_at: stamp })
    .eq("org_id", ctx.org.id)
    .eq("user_id", ctx.user.id)
    .is("read_at", null);

  // 사이드바 점도 함께 끈다(화면별 워터마크 일괄 갱신).
  await touchAllSurfaces(ctx, stamp);
}

/** 화면 진입 — 그 화면의 점만 끈다. 숫자는 절대 건드리지 않는다. */
export async function markSurfaceSeen(
  ctx: Ctx,
  surfaceKey: SurfaceKey,
  now = new Date(),
): Promise<void> {
  if (!hasSupabaseEnv()) return;
  const supabase = await createClient();

  await supabase.from("notification_surface_seen").upsert(
    {
      org_id: ctx.org.id,
      user_id: ctx.user.id,
      surface_key: surfaceKey,
      seen_at: now.toISOString(),
    },
    { onConflict: "org_id,user_id,surface_key" },
  );
}

async function touchAllSurfaces(ctx: Ctx, stamp: string): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("audit_logs")
    .select("target_type")
    .eq("org_id", ctx.org.id)
    .order("at", { ascending: false })
    .limit(200);

  const keys = new Set<SurfaceKey>();
  for (const row of (data ?? []) as Array<{ target_type: string | null }>) {
    const key = surfaceOfFeedItem({ target_type: row.target_type } as FeedItem);
    if (key) keys.add(key);
  }
  if (keys.size === 0) return;

  await supabase.from("notification_surface_seen").upsert(
    [...keys].map((surface_key) => ({
      org_id: ctx.org.id,
      user_id: ctx.user.id,
      surface_key,
      seen_at: stamp,
    })),
    { onConflict: "org_id,user_id,surface_key" },
  );
}

/**
 * 회사 스위처용 — 회사별 내 할 일 건수.
 *
 * 조직 경계를 넘는 유일한 조회다. 그래서 **건수만** 가져오고 제목·본문은 가져오지 않는다
 * (다른 회사 소식 내용이 현재 화면에 새어들 여지를 없앤다).
 * RLS(notifications_select_own)가 내 멤버십 조직으로 이미 제한한다.
 */
export async function loadOrgActionCounts(): Promise<Record<string, BadgeState>> {
  if (!hasSupabaseEnv()) return {};
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return {};

    const { data } = await supabase
      .from("notifications")
      .select("org_id")
      .eq("user_id", userId)
      .eq("is_action", true)
      .is("resolved_at", null);

    const counts = new Map<string, number>();
    for (const row of (data ?? []) as Array<{ org_id: string }>) {
      counts.set(row.org_id, (counts.get(row.org_id) ?? 0) + 1);
    }

    const out: Record<string, BadgeState> = {};
    for (const [orgId, count] of counts) {
      out[orgId] = { kind: "count", count, display: count > 99 ? "99+" : String(count) };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * 처리 완료 — 숫자에서 뺀다. 실제 행동을 마쳤을 때만 호출한다.
 * (화면 진입 경로에서는 절대 호출하지 않는다.)
 */
export async function resolveNotification(
  ctx: Ctx,
  id: string,
  now = new Date(),
): Promise<void> {
  if (!hasSupabaseEnv()) return;
  const supabase = await createClient();
  const stamp = now.toISOString();

  await supabase
    .from("notifications")
    .update({ resolved_at: stamp, read_at: stamp })
    .eq("id", id)
    .eq("org_id", ctx.org.id)
    .eq("user_id", ctx.user.id)
    .is("resolved_at", null);
}
