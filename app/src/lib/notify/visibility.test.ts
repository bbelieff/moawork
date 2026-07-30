import { describe, it, expect } from "vitest";
import {
  myNotificationsFor,
  onlyOrg,
  orgFeedFor,
  surfaceForTarget,
  visibleFeed,
} from "./visibility";
import type { FeedItem, Notification } from "./types";

function feed(over: Partial<FeedItem> = {}): FeedItem {
  return {
    id: "f1",
    org_id: "org1",
    actor: "other",
    action: "deal.move",
    target_type: "deal",
    target_id: "d1",
    at: "2026-07-22T00:00:00.000Z",
    ...over,
  };
}

function notif(over: Partial<Notification> = {}): Notification {
  return {
    id: "n1",
    org_id: "org1",
    user_id: "me",
    type: "assigned",
    title: "t",
    body: null,
    target_type: "deal",
    target_id: "d1",
    actor_id: "other",
    is_action: false,
    read_at: null,
    resolved_at: null,
    created_at: "2026-07-22T00:00:00.000Z",
    ...over,
  };
}

describe("★ 다른 회사 소식 혼입 0", () => {
  it("현재 조직 소식만 남긴다", () => {
    const items = [feed({ id: "a", org_id: "org1" }), feed({ id: "b", org_id: "org2" })];
    expect(onlyOrg(items, "org1").map((i) => i.id)).toEqual(["a"]);
  });

  it("내 알림도 조직 경계를 넘지 않는다", () => {
    const items = [notif({ id: "a", org_id: "org1" }), notif({ id: "b", org_id: "org2" })];
    expect(myNotificationsFor(items, "org1", "me").map((n) => n.id)).toEqual(["a"]);
  });

  it("남의 인박스는 보이지 않는다", () => {
    const items = [notif({ id: "a", user_id: "me" }), notif({ id: "b", user_id: "someone" })];
    expect(myNotificationsFor(items, "org1", "me").map((n) => n.id)).toEqual(["a"]);
  });
});

describe("★ 담당범위(scope=assigned) 반영", () => {
  const assigned = { scope: "assigned" as const, userId: "me", assignedDealIds: new Set(["mine"]) };

  it("다른 담당자의 딜 소식은 보이지 않는다", () => {
    const items = [feed({ id: "a", target_id: "mine" }), feed({ id: "b", target_id: "yours" })];
    expect(visibleFeed(items, assigned).map((i) => i.id)).toEqual(["a"]);
  });

  it("내가 일으킨 소식은 담당 여부와 무관하게 보인다", () => {
    const items = [feed({ id: "a", target_id: "yours", actor: "me" })];
    expect(visibleFeed(items, assigned).map((i) => i.id)).toEqual(["a"]);
  });

  it("딜이 아닌 조직 단위 소식(공지)은 공유된다", () => {
    const items = [feed({ id: "a", target_type: "notice", target_id: "x" })];
    expect(visibleFeed(items, assigned).map((i) => i.id)).toEqual(["a"]);
  });

  it("scope=all 은 조직 전체 소식을 본다", () => {
    const items = [feed({ id: "a", target_id: "mine" }), feed({ id: "b", target_id: "yours" })];
    const all = { scope: "all" as const, userId: "me", assignedDealIds: new Set<string>() };
    expect(visibleFeed(items, all).map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("조직 격리와 담당범위가 함께 적용된다", () => {
    const items = [
      feed({ id: "a", org_id: "org1", target_id: "mine" }),
      feed({ id: "b", org_id: "org1", target_id: "yours" }),
      feed({ id: "c", org_id: "org2", target_id: "mine" }),
    ];
    expect(orgFeedFor(items, "org1", assigned).map((i) => i.id)).toEqual(["a"]);
  });
});

describe("surfaceForTarget — 점을 붙일 메뉴 결정", () => {
  it("알려진 타입을 사이드바 key 로 매핑한다", () => {
    expect(surfaceForTarget("deal")).toBe("work");
    expect(surfaceForTarget("notice")).toBe("notice");
    expect(surfaceForTarget("member_approval")).toBe("members");
  });

  it("모르는 타입·빈 값은 뱃지를 붙이지 않는다", () => {
    expect(surfaceForTarget("unknown")).toBeNull();
    expect(surfaceForTarget(null)).toBeNull();
  });
});
