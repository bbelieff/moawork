/**
 * ★ 뱃지 계약 고정 테스트.
 * 이 파일이 깨지면 "봤다/했다" 구분이 무너진 것이다 — 할 일이 조용히 사라지는 사고로 직결된다.
 */
import { describe, it, expect } from "vitest";
import {
  applyMarkAllRead,
  applyResolve,
  applyScreenEnter,
  bellBadge,
  computeBadge,
  countOpenActions,
  formatBadgeCount,
  isOpenAction,
  isUnseen,
  otherOrgBadge,
  sidebarBadges,
  surfaceDots,
} from "./badge";
import type { FeedItem, Notification, SurfaceSeen } from "./types";

const T0 = "2026-07-22T00:00:00.000Z";
const NOW = "2026-07-22T10:00:00.000Z";

function notif(over: Partial<Notification> = {}): Notification {
  return {
    id: "n1",
    org_id: "org1",
    user_id: "u1",
    type: "assigned",
    title: "제목",
    body: null,
    target_type: "deal",
    target_id: "d1",
    actor_id: "u2",
    is_action: false,
    read_at: null,
    resolved_at: null,
    created_at: T0,
    ...over,
  };
}

function feed(over: Partial<FeedItem> = {}): FeedItem {
  return {
    id: "f1",
    org_id: "org1",
    actor: "u2",
    action: "deal.move",
    target_type: "deal",
    target_id: "d1",
    at: T0,
    ...over,
  };
}

const surfaceOfDeal = () => "work";

describe("formatBadgeCount — 99 초과 절단", () => {
  it("99 까지는 그대로", () => {
    expect(formatBadgeCount(1)).toBe("1");
    expect(formatBadgeCount(99)).toBe("99");
  });

  it("100 이상은 99+", () => {
    expect(formatBadgeCount(100)).toBe("99+");
    expect(formatBadgeCount(1234)).toBe("99+");
  });
});

describe("숫자/점 판정", () => {
  it("행동 필요 + 미처리 = 할 일(숫자)", () => {
    expect(isOpenAction(notif({ is_action: true }))).toBe(true);
  });

  it("읽어도 처리 전이면 여전히 할 일이다", () => {
    expect(isOpenAction(notif({ is_action: true, read_at: NOW }))).toBe(true);
  });

  it("처리하면 할 일에서 빠진다", () => {
    expect(isOpenAction(notif({ is_action: true, resolved_at: NOW }))).toBe(false);
  });

  it("행동 불필요 + 미열람 = 점", () => {
    expect(isUnseen(notif({ is_action: false, read_at: null }))).toBe(true);
  });

  it("행동 필요 항목은 점 계산에서 제외한다(숫자로 표시되므로)", () => {
    expect(isUnseen(notif({ is_action: true, read_at: null }))).toBe(false);
  });
});

describe("computeBadge — 숫자가 점을 이긴다", () => {
  it("할 일이 있으면 숫자", () => {
    expect(computeBadge({ actionCount: 3, hasUnseen: true })).toEqual({
      kind: "count",
      count: 3,
      display: "3",
    });
  });

  it("할 일이 없고 안 본 변화만 있으면 점", () => {
    expect(computeBadge({ actionCount: 0, hasUnseen: true })).toEqual({ kind: "dot" });
  });

  it("둘 다 없으면 뱃지 없음", () => {
    expect(computeBadge({ actionCount: 0, hasUnseen: false })).toEqual({ kind: "none" });
  });

  it("숫자는 99+ 로 절단된다", () => {
    expect(computeBadge({ actionCount: 150, hasUnseen: false })).toEqual({
      kind: "count",
      count: 150,
      display: "99+",
    });
  });
});

describe("★ 화면 진입만으로 숫자가 사라지지 않는다", () => {
  it("진입해도 할 일(숫자)은 그대로 남는다", () => {
    const items = [
      notif({ id: "a", is_action: true }),
      notif({ id: "b", is_action: true }),
    ];

    const after = applyScreenEnter(items, "work", NOW, surfaceOfDeal);

    expect(countOpenActions(after)).toBe(2);
    // 진입은 처리가 아니다 — resolved_at 이 찍히면 안 된다.
    expect(after.every((n) => n.resolved_at === null)).toBe(true);
    expect(bellBadge(after)).toEqual({ kind: "count", count: 2, display: "2" });
  });

  it("진입하면 그 화면의 점은 사라진다", () => {
    const items = [notif({ id: "a", is_action: false })];
    const after = applyScreenEnter(items, "work", NOW, surfaceOfDeal);

    expect(after[0]?.read_at).toBe(NOW);
    expect(bellBadge(after)).toEqual({ kind: "none" });
  });

  it("다른 화면의 점은 건드리지 않는다", () => {
    const items = [notif({ id: "a", is_action: false })];
    const after = applyScreenEnter(items, "dash", NOW, surfaceOfDeal);

    expect(after[0]?.read_at).toBeNull();
  });

  it("할 일과 점이 섞여 있으면 점만 사라지고 숫자는 남는다", () => {
    const items = [
      notif({ id: "todo", is_action: true }),
      notif({ id: "seen", is_action: false }),
    ];

    const after = applyScreenEnter(items, "work", NOW, surfaceOfDeal);

    expect(after.find((n) => n.id === "todo")?.resolved_at).toBeNull();
    expect(after.find((n) => n.id === "seen")?.read_at).toBe(NOW);
    expect(bellBadge(after)).toEqual({ kind: "count", count: 1, display: "1" });
  });
});

describe("★ 모두 읽음 — 점만 제거, 숫자는 남는다", () => {
  it("점은 사라지고 숫자는 유지된다", () => {
    const items = [
      notif({ id: "todo", is_action: true }),
      notif({ id: "news", is_action: false }),
    ];

    const after = applyMarkAllRead(items, NOW);

    // 숫자 유지
    expect(countOpenActions(after)).toBe(1);
    expect(after.find((n) => n.id === "todo")?.resolved_at).toBeNull();
    // 점 제거
    expect(after.some(isUnseen)).toBe(false);
    expect(bellBadge(after)).toEqual({ kind: "count", count: 1, display: "1" });
  });

  it("할 일만 있으면 모두 읽음 후에도 뱃지 숫자가 그대로다", () => {
    const items = [notif({ id: "a", is_action: true }), notif({ id: "b", is_action: true })];
    expect(bellBadge(applyMarkAllRead(items, NOW))).toEqual({
      kind: "count",
      count: 2,
      display: "2",
    });
  });
});

describe("applyResolve — 실제로 처리해야 숫자가 준다", () => {
  it("처리한 항목만 숫자에서 빠진다", () => {
    const items = [notif({ id: "a", is_action: true }), notif({ id: "b", is_action: true })];

    const after = applyResolve(items, "a", NOW);

    expect(countOpenActions(after)).toBe(1);
    expect(after.find((n) => n.id === "a")?.resolved_at).toBe(NOW);
    expect(after.find((n) => n.id === "b")?.resolved_at).toBeNull();
  });

  it("이미 처리된 항목의 시각은 덮어쓰지 않는다", () => {
    const items = [notif({ id: "a", is_action: true, resolved_at: T0 })];
    expect(applyResolve(items, "a", NOW)[0]?.resolved_at).toBe(T0);
  });
});

describe("남이 한 일반 활동 = 뱃지 없음", () => {
  it("피드에만 쌓이고 벨 숫자를 올리지 않는다", () => {
    // 일반 활동은 notifications 에 들어가지 않는다 → 벨은 조용하다.
    expect(bellBadge([])).toEqual({ kind: "none" });
  });
});

describe("surfaceDots — 화면별 점", () => {
  const seen: SurfaceSeen[] = [{ surface_key: "work", seen_at: "2026-07-22T05:00:00.000Z" }];

  it("워터마크보다 새 소식이면 점이 켜진다", () => {
    const dots = surfaceDots([feed({ at: "2026-07-22T06:00:00.000Z" })], seen, () => "work");
    expect(dots.work).toEqual({ kind: "dot" });
  });

  it("워터마크보다 오래된 소식은 점을 켜지 않는다", () => {
    const dots = surfaceDots([feed({ at: "2026-07-22T04:00:00.000Z" })], seen, () => "work");
    expect(dots.work).toBeUndefined();
  });

  it("한 번도 안 본 화면은 점이 켜진다", () => {
    const dots = surfaceDots([feed()], [], () => "notice");
    expect(dots.notice).toEqual({ kind: "dot" });
  });
});

describe("sidebarBadges — 숫자가 점을 덮어쓴다", () => {
  it("같은 화면에 할 일과 안 본 변화가 겹치면 숫자로 표시한다", () => {
    const badges = sidebarBadges(
      [notif({ is_action: true })],
      [feed({ at: NOW })],
      [],
      () => "work",
      () => "work",
    );
    expect(badges.work).toEqual({ kind: "count", count: 1, display: "1" });
  });

  it("할 일 없는 화면은 점으로 남는다", () => {
    const badges = sidebarBadges([], [feed({ at: NOW })], [], () => null, () => "notice");
    expect(badges.notice).toEqual({ kind: "dot" });
  });
});

describe("otherOrgBadge — 다른 회사 건수", () => {
  it("현재 회사 건은 제외하고 다른 회사만 센다", () => {
    const items = [
      notif({ id: "a", org_id: "org1", is_action: true }),
      notif({ id: "b", org_id: "org2", is_action: true }),
      notif({ id: "c", org_id: "org2", is_action: true }),
    ];

    const badges = otherOrgBadge(items, "org1");

    expect(badges.org1).toBeUndefined();
    expect(badges.org2).toEqual({ kind: "count", count: 2, display: "2" });
  });

  it("처리된 건은 세지 않는다", () => {
    const items = [notif({ org_id: "org2", is_action: true, resolved_at: NOW })];
    expect(otherOrgBadge(items, "org1")).toEqual({});
  });
});
