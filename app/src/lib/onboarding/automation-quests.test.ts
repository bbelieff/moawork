import { describe, expect, it } from "vitest";
import { parseAutomationQuestDefs } from "./automation-quests";

describe("parseAutomationQuestDefs", () => {
  it("keeps deterministic pipeline order and the generated rule contract", () => {
    expect(parseAutomationQuestDefs([
      {
        questKey: "automation-rule:b",
        ruleId: "b",
        title: "두 번째",
        description: "설명",
        why: null,
        hidden: false,
        completed: true,
        sortOrder: 20,
        judgeParams: { ruleId: "b" },
      },
      {
        questKey: "automation-rule:a",
        ruleId: "a",
        title: "첫 번째",
        description: null,
        why: "이 규칙이 필요한 이유",
        hidden: true,
        completed: false,
        sortOrder: 10,
        judgeParams: { ruleId: "a" },
      },
    ])).toMatchObject([
      { ruleId: "a", source: "automation", judgeKind: "automation_rule_succeeded" },
      { ruleId: "b", source: "automation", judgeKind: "automation_rule_succeeded" },
    ]);
  });

  it("fails closed for missing or malformed fields", () => {
    expect(parseAutomationQuestDefs(null)).toBeNull();
    expect(parseAutomationQuestDefs([{ questKey: "q" }])).toBeNull();
    expect(parseAutomationQuestDefs([{ questKey: "q", ruleId: "r", title: "t", description: null, why: null, hidden: false, completed: false, sortOrder: Number.NaN, judgeParams: {} }])).toBeNull();
  });
});
