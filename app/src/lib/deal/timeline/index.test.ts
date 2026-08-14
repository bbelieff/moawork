import { describe, expect, it } from "vitest";
import type { Activity } from "@/lib/types";
import type { DealComment } from "@/lib/deal/comments";
import { mergeTimeline } from ".";

function activity(id: string, at: string, type = "status"): Activity {
  return { id, org_id: "org-1", deal_id: "deal-1", type, content: `content-${id}`, actor: null, at };
}

function comment(id: string, at: string): DealComment {
  return {
    id,
    author_id: "u1",
    body: `body-${id}`,
    kind: "note",
    mentioned_ids: [],
    created_at: at,
    edited_at: null,
    edit_history: [],
    version: 1,
  };
}

describe("mergeTimeline", () => {
  it("activities 와 comments 를 시간순(오래된 → 최신)으로 합친다", () => {
    const merged = mergeTimeline(
      [activity("a1", "2026-01-01T10:00:00.000Z"), activity("a2", "2026-01-01T12:00:00.000Z")],
      [comment("c1", "2026-01-01T11:00:00.000Z")],
    );
    expect(merged.map((e) => (e.kind === "activity" ? e.activity.id : e.comment.id))).toEqual([
      "a1",
      "c1",
      "a2",
    ]);
  });

  it("한쪽이 비어도 안전하다", () => {
    expect(mergeTimeline([], [])).toEqual([]);
    expect(mergeTimeline([activity("a1", "2026-01-01T00:00:00.000Z")], [])).toHaveLength(1);
    expect(mergeTimeline([], [comment("c1", "2026-01-01T00:00:00.000Z")])).toHaveLength(1);
  });

  it("원본 배열을 변형하지 않는다", () => {
    const activities = [activity("a2", "2026-01-02T00:00:00.000Z"), activity("a1", "2026-01-01T00:00:00.000Z")];
    const copy = [...activities];
    mergeTimeline(activities, []);
    expect(activities).toEqual(copy);
  });
});
