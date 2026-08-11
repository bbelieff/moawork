import { describe, expect, it, vi } from "vitest";
import { executeAutomation, executeAutomationBatch } from "./executor.js";
import type {
  AutomationHistoryPort,
  AutomationJobData,
  ExecutionHistoryEntry,
} from "./types.js";

function job(ruleId: string, visited: readonly string[] = []): AutomationJobData {
  return {
    execution_key: "event:item-1:status:done",
    visited_rule_ids: visited,
    evaluation: {
      decision: {
        item_id: "item-1",
        from_group_id: "new",
        to_group_id: "contact",
        rule_id: ruleId,
      },
      blocked_reasons: [],
    },
  };
}

function history(claimed = true) {
  const entries: ExecutionHistoryEntry[] = [];
  const port: AutomationHistoryPort = {
    claim: vi.fn(async () => claimed),
    append: vi.fn(async (entry) => { entries.push(entry); }),
  };
  return { entries, port };
}

describe("automation executor", () => {
  it("executes GT04's decision and records rule, time and success", async () => {
    const h = history();
    const moveItem = vi.fn(async () => undefined);
    const outcome = await executeAutomation({
      actions: { moveItem }, history: h.port,
      now: () => new Date("2026-08-11T00:00:00.000Z"),
    }, job("new-to-contact"));

    expect(moveItem).toHaveBeenCalledWith(expect.objectContaining({
      rule_id: "new-to-contact", to_group_id: "contact",
    }));
    expect(outcome).toMatchObject({ status: "succeeded", rule_id: "new-to-contact" });
    expect(h.entries).toEqual([outcome]);
  });

  it("records a failed rule and continues with the next rule", async () => {
    const h = history();
    const moveItem = vi.fn(async (decision: { rule_id: string }) => {
      if (decision.rule_id === "broken") throw new TypeError("boom");
    });
    const outcomes = await executeAutomationBatch(
      { actions: { moveItem }, history: h.port },
      [job("broken"), job("still-runs")],
    );

    expect(outcomes.map((outcome) => outcome.status)).toEqual(["failed", "succeeded"]);
    expect(moveItem).toHaveBeenCalledTimes(2);
    expect(h.entries[0]).toMatchObject({ rule_id: "broken", error_code: "TypeError" });
  });

  it("blocks A to B to A loops before the repeated action runs", async () => {
    const h = history();
    const moveItem = vi.fn(async () => undefined);
    const outcome = await executeAutomation(
      { actions: { moveItem }, history: h.port },
      job("rule-a", ["rule-a", "rule-b"]),
    );

    expect(outcome).toMatchObject({ status: "blocked", error_code: "automation_loop_blocked" });
    expect(moveItem).not.toHaveBeenCalled();
  });

  it("uses the durable claim as an idempotency gate", async () => {
    const h = history(false);
    const moveItem = vi.fn(async () => undefined);
    const outcome = await executeAutomation(
      { actions: { moveItem }, history: h.port }, job("same-rule"),
    );

    expect(outcome.status).toBe("duplicate");
    expect(moveItem).not.toHaveBeenCalled();
  });

  it("records GT04 block reasons without executing an action", async () => {
    const h = history();
    const moveItem = vi.fn(async () => undefined);
    const outcome = await executeAutomation({ actions: { moveItem }, history: h.port }, {
      execution_key: "blocked-event",
      evaluation: { decision: null, blocked_reasons: ["seal: is label:done 조건이 맞지 않습니다."] },
    });

    expect(outcome).toMatchObject({ status: "blocked", rule_id: null });
    expect(outcome.blocked_reasons).toHaveLength(1);
    expect(moveItem).not.toHaveBeenCalled();
  });
});
