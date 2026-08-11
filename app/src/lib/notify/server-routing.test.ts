import { describe, expect, it } from "vitest";
import { routeNotificationFeed } from "./recipients";
import type { FeedItem } from "./types";

const feed = (id: string): FeedItem => ({ id, org_id: "o", actor: "actor", action: "changed", target_type: "deal", target_id: id, at: "2026-08-11T00:00:00Z" });

describe("routeNotificationFeed", () => {
  it("실제 feed 생성 경로가 담당자 유무에 따라 resolver 결과를 소비한다", () => {
    const items = [feed("assigned"), feed("team")];
    const assignees = new Map<string, string | null>([["assigned", "u1"], ["team", null]]);
    expect(routeNotificationFeed(items, "u2", ["u1", "u2"], assignees).map((item) => item.feed.id)).toEqual(["team"]);
    expect(routeNotificationFeed(items, "u1", ["u1", "u2"], assignees).map((item) => item.feed.id)).toEqual(["assigned", "team"]);
  });
});
