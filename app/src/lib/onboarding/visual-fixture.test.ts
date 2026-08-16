import { describe, expect, it } from "vitest";
import { AUTOMATION_QUEST_VISUAL_FIXTURE } from "./visual-fixture";

describe("BBE-113 isolated visual fixture", () => {
  it("contains only deterministic non-customer onboarding examples", () => {
    expect(AUTOMATION_QUEST_VISUAL_FIXTURE.quests).toHaveLength(2);
    expect(AUTOMATION_QUEST_VISUAL_FIXTURE.quests.every((quest) => quest.source === "automation")).toBe(true);
  });
});
