import { describe, expect, it, vi } from "vitest";
import type { Job } from "pg-boss";
import { createAutomationHandler } from "./register.js";
import type { AutomationJobData, ExecutionHistoryEntry } from "./types.js";

function queued(ruleId: string): Job<AutomationJobData> {
  return {
    id: `job-${ruleId}`,
    name: "automation.execute",
    expireInSeconds: 60,
    data: {
      execution_key: `event-${ruleId}`,
      evaluation: {
        decision: {
          item_id: `item-${ruleId}`,
          from_group_id: "new",
          to_group_id: "contact",
          rule_id: ruleId,
        },
        blocked_reasons: [],
      },
    },
  };
}

describe("automation pg-boss handler", () => {
  it("returns persisted job output and isolates an action failure", async () => {
    const entries: ExecutionHistoryEntry[] = [];
    const handler = createAutomationHandler({
      actions: {
        moveItem: vi.fn(async (decision) => {
          if (decision.rule_id === "broken") throw new Error("broken");
        }),
      },
      history: {
        claim: vi.fn(async () => true),
        append: vi.fn(async (entry) => { entries.push(entry); }),
      },
    });

    const output = await handler([queued("broken"), queued("next")]);

    expect(output.map((entry) => entry.status)).toEqual(["failed", "succeeded"]);
    expect(entries.map((entry) => entry.rule_id)).toEqual(["broken", "next"]);
  });
});
