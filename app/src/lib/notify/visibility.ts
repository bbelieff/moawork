/**
 * 소식 가시성 — 조직 격리 + 담당범위(scope).
 *
 * RLS 를 우회하지 않는다. DB 정책(008_notifications.sql)이 1차 방어선이고,
 * 여기 함수는 같은 규칙을 앱 레이어에서 한 번 더 강제한다(다중 방어).
 * 로컬/테스트 소스처럼 RLS 가 없는 경로에서도 규칙이 동일하게 지켜져야 하기 때문이다.
 */

import type { MemberScope } from "@/lib/types";
import type { FeedItem, Notification, SurfaceKey } from "./types";

/** 조직 격리 — 다른 회사 소식은 절대 섞이면 안 된다. */
export function onlyOrg<T extends { org_id: string }>(items: readonly T[], orgId: string): T[] {
  return items.filter((i) => i.org_id === orgId);
}

/** 내 알림만 — 남의 인박스는 보이지 않는다. */
export function onlyMine(items: readonly Notification[], userId: string): Notification[] {
  return items.filter((n) => n.user_id === userId);
}

export interface ScopeContext {
  scope: MemberScope;
  userId: string;
  /** 내가 담당인 딜 id 집합. scope='all' 이면 사용하지 않는다. */
  assignedDealIds: ReadonlySet<string>;
}

/**
 * 담당범위 필터.
 * scope='assigned' 멤버는 남의 딜 소식을 볼 수 없다.
 * 딜이 아닌 조직 단위 소식(공지 등)은 담당범위와 무관하게 공유한다 — DB 정책과 동일한 판단.
 */
export function visibleFeed(items: readonly FeedItem[], ctx: ScopeContext): FeedItem[] {
  if (ctx.scope === "all") return [...items];

  return items.filter((item) => {
    if (item.actor === ctx.userId) return true; // 내가 일으킨 소식
    if (item.target_type !== "deal") return true; // 조직 단위 소식
    return item.target_id !== null && ctx.assignedDealIds.has(item.target_id);
  });
}

/** 조직 + 담당범위를 한 번에 적용한 회사 소식. */
export function orgFeedFor(
  items: readonly FeedItem[],
  orgId: string,
  ctx: ScopeContext,
): FeedItem[] {
  return visibleFeed(onlyOrg(items, orgId), ctx);
}

/** 조직 + 수신자를 한 번에 적용한 내 알림. */
export function myNotificationsFor(
  items: readonly Notification[],
  orgId: string,
  userId: string,
): Notification[] {
  return onlyMine(onlyOrg(items, orgId), userId);
}

/**
 * target_type → 사이드바 화면 key.
 * 점 뱃지를 어느 메뉴에 붙일지 결정한다. 모르는 타입은 null(뱃지 없음).
 */
const SURFACE_BY_TARGET: Record<string, SurfaceKey> = {
  deal: "work",
  company: "company",
  notice: "notice",
  settlement: "acct",
  member: "members",
  member_approval: "members",
};

export function surfaceForTarget(targetType: string | null | undefined): SurfaceKey | null {
  if (!targetType) return null;
  return SURFACE_BY_TARGET[targetType] ?? null;
}

export function surfaceOfNotification(n: Notification): SurfaceKey | null {
  return surfaceForTarget(n.target_type);
}

export function surfaceOfFeedItem(item: FeedItem): SurfaceKey | null {
  return surfaceForTarget(item.target_type);
}
