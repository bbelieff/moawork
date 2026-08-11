import { describe, expect, it, vi } from "vitest";
import { executeAutomation, executeAutomationBatch } from "./executor.js";
import { nextAutomationJob, type AutomationJobData, type AutomationStorePort } from "./types.js";

function job(ruleId: string, visited: readonly string[] = []): AutomationJobData {
  return {
    execution_key: "event:item-1:status:done",
    org_id: "org-1",
    visited_rule_ids: visited,
    evaluation: {
      decision: { item_id: "item-1", from_group_id: "new", to_group_id: "contact", rule_id: ruleId },
      blocked_reasons: [],
    },
  };
}

function store(): AutomationStorePort {
  return {
    executeMove: vi.fn(async (input) => ({
      execution_key: input.execution_key, org_id: input.org_id,
      visited_rule_ids: [...input.visited_rule_ids, input.evaluation.decision.rule_id],
      rule_id: input.evaluation.decision.rule_id, item_id: input.evaluation.decision.item_id,
      status: "succeeded" as const,
    })),
    recordBlocked: vi.fn(async (input) => ({
      execution_key: input.execution_key, org_id: input.org_id,
      visited_rule_ids: input.visited_rule_ids, rule_id: null, item_id: null,
      status: "blocked" as const, blocked_reasons: input.evaluation.blocked_reasons,
    })),
  };
}

describe("automation executor", () => {
  it("executes GT04's decision through the atomic store", async () => {
    const s = store();
    const result = await executeAutomation({ store: s }, job("new-to-contact"));
    expect(s.executeMove).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ status: "succeeded", rule_id: "new-to-contact" });
  });

  it("contains a failed store call and continues with the next rule", async () => {
    const s = store();
    vi.mocked(s.executeMove)
      .mockRejectedValueOnce(new TypeError("boom"))
      .mockImplementationOnce(async (input) => ({
        execution_key: input.execution_key, org_id: input.org_id,
        visited_rule_ids: input.visited_rule_ids, rule_id: input.evaluation.decision.rule_id,
        item_id: input.evaluation.decision.item_id, status: "succeeded" as const,
      }));
    const results = await executeAutomationBatch({ store: s }, [job("broken"), job("next")]);
    expect(results.map((result) => result.status)).toEqual(["failed", "succeeded"]);
  });

  it("blocks A to B to A before persistence", async () => {
    const s = store();
    const result = await executeAutomation({ store: s }, job("rule-a", ["rule-a", "rule-b"]));
    expect(result.status).toBe("blocked");
    expect(s.executeMove).not.toHaveBeenCalled();
    expect(s.recordBlocked).toHaveBeenCalledOnce();
  });

  it("requires and propagates the trace to a follow-up job", () => {
    const parent = job("rule-a", []);
    const child = nextAutomationJob(parent, job("rule-b").evaluation);
    const repeated = nextAutomationJob(child, job("rule-a").evaluation);
    expect(child.visited_rule_ids).toEqual(["rule-a"]);
    expect(repeated.visited_rule_ids).toEqual(["rule-a", "rule-b"]);
    expect(repeated.execution_key).toBe(parent.execution_key);
  });

  it("records GT04 block reasons", async () => {
    const s = store();
    const result = await executeAutomation({ store: s }, {
      execution_key: "blocked", org_id: "org-1", visited_rule_ids: [],
      evaluation: { decision: null, blocked_reasons: ["seal condition blocked"] },
    });
    expect(result).toMatchObject({ status: "blocked", blocked_reasons: ["seal condition blocked"] });
  });
});
