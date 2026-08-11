import { describe, expect, it, vi } from "vitest";
import { executeAutomation, executeAutomationBatch } from "./executor.js";
import type { AutomationStorePort } from "./types.js";

const job = { execution_key: "execution-1" };

function store(): AutomationStorePort {
  return { execute: vi.fn(async (executionKey) => ({ execution_key: executionKey, visited_rule_ids: ["rule-a"], status: "succeeded" as const })) };
}

describe("automation executor", () => {
  it("forwards only the opaque DB-issued execution key", async () => {
    const current = store();
    await expect(executeAutomation({ store: current }, job)).resolves.toMatchObject({ status: "succeeded" });
    expect(current.execute).toHaveBeenCalledWith("execution-1");
  });

  it("contains a failed store call and continues with the next job", async () => {
    const current = store();
    vi.mocked(current.execute).mockRejectedValueOnce(new TypeError("boom")).mockResolvedValueOnce({ execution_key: "execution-2", visited_rule_ids: [], status: "blocked" });
    const results = await executeAutomationBatch({ store: current }, [job, { execution_key: "execution-2" }]);
    expect(results.map((result) => result.status)).toEqual(["failed", "blocked"]);
    expect(current.execute).toHaveBeenNthCalledWith(2, "execution-2");
  });
});
