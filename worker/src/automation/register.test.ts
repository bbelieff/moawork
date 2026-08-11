import { describe, expect, it, vi } from "vitest";
import type { Job } from "pg-boss";
import { AUTOMATION_PRODUCER_STATUS, automationSingletonKey, createAutomationHandler, enqueueAutomation, isAutomationJobData } from "./register.js";
import type { AutomationJobData, AutomationStorePort } from "./types.js";

function queued(executionKey: string): Job<AutomationJobData> {
  return { id: `job-${executionKey}`, name: "automation.execute", expireInSeconds: 60, data: { execution_key: executionKey } };
}

describe("automation pg-boss handler", () => {
  it("keeps the worker registered while the product producer remains unavailable", () => {
    expect(AUTOMATION_PRODUCER_STATUS).toBe("WORKER_REGISTERED_BUT_PRODUCER_NOT_READY");
  });

  it("accepts no tenant, decision or trace payload fields", async () => {
    const send = vi.fn().mockResolvedValue("job-id");
    await enqueueAutomation({ send } as never, queued("key-a").data);
    expect(send).toHaveBeenCalledWith("automation.execute", { execution_key: "key-a" }, { singletonKey: '["key-a"]' });
    expect(isAutomationJobData({ execution_key: "key-a", org_id: "forged" })).toBe(false);
    expect(automationSingletonKey({ execution_key: "key-a" })).toBe('["key-a"]');
  });

  it("processes later jobs after a failed job and preserves retry", async () => {
    const store: AutomationStorePort = {
      execute: vi.fn(async (executionKey) => {
        if (executionKey === "broken") throw new Error("broken");
        return { execution_key: executionKey, visited_rule_ids: [], status: "succeeded" as const };
      }),
    };
    await expect(createAutomationHandler({ store })([queued("broken"), queued("next")])).rejects.toThrow("automation_batch_retry");
    expect(store.execute).toHaveBeenNthCalledWith(2, "next");
  });
});
