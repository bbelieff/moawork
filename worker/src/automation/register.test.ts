import { describe, expect, it, vi } from "vitest";
import type { Job } from "pg-boss";
import { createAutomationHandler, enqueueAutomation } from "./register.js";
import type { AutomationJobData, AutomationStorePort } from "./types.js";

function queued(ruleId: string): Job<AutomationJobData> {
  return {
    id: `job-${ruleId}`, name: "automation.execute", expireInSeconds: 60,
    data: {
      execution_key: `event-${ruleId}`, org_id: "org-1", visited_rule_ids: [],
      evaluation: {
        decision: { item_id: `item-${ruleId}`, from_group_id: "new", to_group_id: "contact", rule_id: ruleId },
        blocked_reasons: [],
      },
    },
  };
}

describe("automation pg-boss handler", () => {
  it("offers a stable producer hand-off for GT04 evaluations", async () => {
    const send = vi.fn().mockResolvedValue("job-id");
    const data = queued("rule-a").data;
    await expect(enqueueAutomation({ send } as never, data)).resolves.toBe("job-id");
    expect(send).toHaveBeenCalledWith(
      "automation.execute",
      data,
      { singletonKey: "event-rule-a:rule-a" },
    );
  });

  it("persists job output and isolates one failed rule", async () => {
    const store: AutomationStorePort = {
      executeMove: vi.fn(async (input) => {
        if (input.evaluation.decision.rule_id === "broken") throw new Error("broken");
        return {
          execution_key: input.execution_key, org_id: input.org_id,
          visited_rule_ids: input.visited_rule_ids, rule_id: input.evaluation.decision.rule_id,
          item_id: input.evaluation.decision.item_id, status: "succeeded" as const,
        };
      }),
      recordBlocked: vi.fn(),
    };
    await expect(createAutomationHandler({ store })([queued("broken"), queued("next")]))
      .rejects.toThrow("automation_batch_retry");
    expect(store.executeMove).toHaveBeenCalledTimes(2);
  });
});
