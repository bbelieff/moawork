import { describe, expect, it } from "vitest";
import type { ItemWithValues } from "@/lib/boards/types";
import { applyNoticePerspective, parseNoticePerspective, projectNoticeMetadata } from "./perspectives";

function row(id: string, author: string | null, audience: unknown = null): ItemWithValues {
  return {
    id, org_id: "org", board_id: "board", group_id: null, title: id,
    assigned_to: null, deal_id: null, sort_order: 0,
    created_at: "2026-09-06T01:02:03.000Z", updated_at: "2026-09-06T01:02:03.000Z",
    values: { author, audience } as ItemWithValues["values"],
  };
}

describe("notice perspectives", () => {
  const rows = [row("all", "other"), row("mine", "viewer", "notice-audience-managers")];

  it("accepts only perspectives supported by the current storage contract", () => {
    expect(parseNoticePerspective("authored")).toBe("authored");
    expect(parseNoticePerspective("forged")).toBe("all");
    expect(parseNoticePerspective("department")).toBe("all");
    expect(parseNoticePerspective("for-me")).toBe("all");
  });

  it("matches 내가 작성 by the canonical author person value", () => {
    expect(applyNoticePerspective(rows, "authored", "viewer").map((entry) => entry.id)).toEqual(["mine"]);
  });

  it("projects 작성일 from the canonical item timestamp without mutating the source", () => {
    const source = row("one", "viewer");
    expect(projectNoticeMetadata(source).values.created_on).toBe("2026-09-06");
    expect(source.values.created_on).toBeUndefined();
  });
});
