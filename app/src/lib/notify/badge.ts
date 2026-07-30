/**
 * ★ 뱃지 규칙 — mod.notify 의 핵심 계약. 모든 분기는 badge.test.ts 로 고정돼 있다.
 *
 *   🔴 숫자 = 내가 할 일(배정·요청·멘션). **화면에 들어가도 사라지지 않는다.**
 *             실제로 처리(resolve)해야 사라진다.
 *   •  점  = 안 본 변화. 해당 화면에 들어가면 사라진다.
 *   남이 한 일반 활동 = 뱃지 없음(소식창에만 쌓인다).
 *   "모두 읽음" = 점만 일괄 제거. 숫자는 남는다.
 *   99 초과 = "99+" 절단.
 *
 * "봤다"와 "했다"를 섞으면 할 일이 조용히 사라져 사고가 난다.
 * 그래서 읽음(read_at)은 점에만, 처리(resolved_at)는 숫자에만 작용한다.
 */

import type { BadgeState, FeedItem, Notification, SurfaceKey, SurfaceSeen } from "./types";

/** 숫자 뱃지 절단 기준. */
export const BADGE_MAX = 99;

/** 99 초과는 99+ 로 절단한다. */
export function formatBadgeCount(count: number): string {
  return count > BADGE_MAX ? `${BADGE_MAX}+` : String(count);
}

/**
 * 내가 할 일(숫자) 판정.
 * read_at 은 보지 않는다 — 읽어도 처리 전이면 여전히 할 일이다.
 */
export function isOpenAction(n: Notification): boolean {
  return n.is_action && n.resolved_at === null;
}

/** 안 본 항목(점) 판정. 행동 필요 항목은 숫자로 표시되므로 점 계산에서 제외한다. */
export function isUnseen(n: Notification): boolean {
  return !n.is_action && n.read_at === null;
}

/** 미해결 할 일 개수. */
export function countOpenActions(items: readonly Notification[]): number {
  return items.filter(isOpenAction).length;
}

/**
 * 뱃지 상태 결정 — 숫자가 점을 이긴다.
 * 할 일이 하나라도 있으면 숫자로 보여야 사용자가 "처리해야 함"을 안다.
 */
export function computeBadge(input: { actionCount: number; hasUnseen: boolean }): BadgeState {
  if (input.actionCount > 0) {
    return { kind: "count", count: input.actionCount, display: formatBadgeCount(input.actionCount) };
  }
  return input.hasUnseen ? { kind: "dot" } : { kind: "none" };
}

/** 벨(내 알림 수) 뱃지. */
export function bellBadge(items: readonly Notification[]): BadgeState {
  return computeBadge({
    actionCount: countOpenActions(items),
    hasUnseen: items.some(isUnseen),
  });
}

/**
 * 화면 진입 처리 — 해당 화면의 점만 끈다.
 *
 * ★ 숫자는 절대 건드리지 않는다. 이 함수가 is_action 항목의 resolved_at 을 채우면
 *   "화면만 열었는데 할 일이 사라지는" 사고가 된다.
 */
export function applyScreenEnter(
  items: readonly Notification[],
  surfaceKey: SurfaceKey,
  now: string,
  surfaceOf: (n: Notification) => SurfaceKey | null,
): Notification[] {
  return items.map((n) => {
    if (n.is_action) return n; // 할 일은 진입만으로 소거되지 않는다.
    if (n.read_at !== null) return n;
    if (surfaceOf(n) !== surfaceKey) return n;
    return { ...n, read_at: now };
  });
}

/**
 * "모두 읽음" — 점만 일괄 제거한다.
 * 행동 필요 항목에도 read_at 은 찍되(목록에서 새것 표시 해제), resolved_at 은 건드리지 않아
 * 숫자는 그대로 남는다.
 */
export function applyMarkAllRead(items: readonly Notification[], now: string): Notification[] {
  return items.map((n) => (n.read_at === null ? { ...n, read_at: now } : n));
}

/** 처리 완료 — 숫자에서 빠진다. 실제 행동을 마쳤을 때만 호출한다. */
export function applyResolve(
  items: readonly Notification[],
  id: string,
  now: string,
): Notification[] {
  return items.map((n) =>
    n.id === id ? { ...n, resolved_at: n.resolved_at ?? now, read_at: n.read_at ?? now } : n,
  );
}

/**
 * 사이드바 화면별 점 — 워터마크(seen_at)보다 새로운 피드가 있으면 켠다.
 * 남이 한 일반 활동은 숫자가 되지 않고 여기(점)에만 반영된다.
 */
export function surfaceDots(
  feed: readonly FeedItem[],
  seen: readonly SurfaceSeen[],
  surfaceOf: (item: FeedItem) => SurfaceKey | null,
): Record<SurfaceKey, BadgeState> {
  const watermark = new Map(seen.map((s) => [s.surface_key, s.seen_at]));
  const out: Record<SurfaceKey, BadgeState> = {};

  for (const item of feed) {
    const key = surfaceOf(item);
    if (key === null) continue;
    const mark = watermark.get(key);
    // 워터마크가 없으면 = 한 번도 안 본 화면 → 새 변화로 취급한다.
    if (mark === undefined || item.at > mark) {
      out[key] = { kind: "dot" };
    }
  }
  return out;
}

/**
 * 사이드바 메뉴 뱃지 — 내 할 일(숫자)이 있는 화면은 숫자가 점을 덮어쓴다.
 */
export function sidebarBadges(
  items: readonly Notification[],
  feed: readonly FeedItem[],
  seen: readonly SurfaceSeen[],
  surfaceOfNotification: (n: Notification) => SurfaceKey | null,
  surfaceOfFeed: (item: FeedItem) => SurfaceKey | null,
): Record<SurfaceKey, BadgeState> {
  const badges = surfaceDots(feed, seen, surfaceOfFeed);

  const actionCounts = new Map<SurfaceKey, number>();
  for (const n of items) {
    if (!isOpenAction(n)) continue;
    const key = surfaceOfNotification(n);
    if (key === null) continue;
    actionCounts.set(key, (actionCounts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of actionCounts) {
    badges[key] = { kind: "count", count, display: formatBadgeCount(count) };
  }
  return badges;
}

/**
 * 회사 스위처 뱃지 — 지금 보고 있지 않은 회사의 내 할 일 건수.
 * 다른 회사 것이 현재 회사 뱃지에 섞이면 안 되므로 org_id 로 엄격히 가른다.
 */
export function otherOrgBadge(
  items: readonly Notification[],
  currentOrgId: string,
): Record<string, BadgeState> {
  const counts = new Map<string, number>();
  for (const n of items) {
    if (n.org_id === currentOrgId) continue;
    if (!isOpenAction(n)) continue;
    counts.set(n.org_id, (counts.get(n.org_id) ?? 0) + 1);
  }
  const out: Record<string, BadgeState> = {};
  for (const [orgId, count] of counts) {
    out[orgId] = { kind: "count", count, display: formatBadgeCount(count) };
  }
  return out;
}
