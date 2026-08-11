import { describe, expect, it } from "vitest";
import { routeNotificationFeed } from "./recipients";
import type { FeedItem } from "./types";

const feed = (id: string): FeedItem => ({ id, org_id: "o", actor: "actor", action: "changed", target_type: "deal", target_id: id, at: "2026-08-11T00:00:00Z" });

describe("routeNotificationFeed", () => {
  it("실제 feed 생성 경로가 담당자 유무에 따라 resolver 결과를 소비한다", () => {
    const items = [feed("assigned"), feed("team")];
    const routes = new Map([["assigned", { assigneeId: "u1", teamMembers: ["u1", "u2"] }], ["team", { assigneeId: null, teamMembers: ["u1", "u2"] }]]);
    expect(routeNotificationFeed(items, "u2", routes).map((item) => item.feed.id)).toEqual(["team"]);
    expect(routeNotificationFeed(items, "u1", routes).map((item) => item.feed.id)).toEqual(["assigned", "team"]);
  });
  it("선행 owner adapter가 계통·카드·개인 입력을 제공하면 실제 feed가 세 층을 소비한다", () => {
    const item = feed("three");
    const routes = new Map([["three", { assigneeId: "owner", teamMembers: [], assigneeHierarchy: [{ userId: "manager", source: "hierarchy" as const, distance: 2, path: ["owner", "lead", "manager"] }], cardDepartmentMembers: ["watcher"], personalSubscriptions: ["subscriber"] }]]);
    expect(routeNotificationFeed([item], "manager", routes)[0]?.recipient).toMatchObject({ source: "hierarchy", distance: 2, locked: true });
    expect(routeNotificationFeed([item], "watcher", routes)[0]?.recipient.source).toBe("card_department");
    expect(routeNotificationFeed([item], "subscriber", routes)[0]?.recipient.source).toBe("personal");
  });
  it("전체 조회 범위는 선행 port가 비어도 기존 회사소식을 보존한다", () => {
    expect(routeNotificationFeed([feed("x")], "admin", new Map(), true)).toHaveLength(1);
  });
  it("담당 범위 사용자에게도 비-deal 조직 소식을 기본 팀 route로 보존한다", () => {
    const notice = { ...feed("notice"), target_type: "notice", target_id: null };
    const routes = new Map([["*", { assigneeId: null, teamMembers: ["member"] }]]);
    expect(routeNotificationFeed([notice], "member", routes, false)).toHaveLength(1);
  });
});
