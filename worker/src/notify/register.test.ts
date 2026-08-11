import { describe, expect, it, vi } from "vitest";
import { enqueueNotifyJob, NOTIFY_QUEUE_OPTIONS } from "./register.js";

describe("notify producer contract", () => {
  it("정책 메타데이터가 있는 job만 실제 큐로 보낸다", async () => {
    const send = vi.fn(async () => undefined);
    await enqueueNotifyJob({ send }, { messageId: "m1", userId: "u1", eventKey: "deal:1", createdAt: "2026-08-11T00:00:00Z", urgency: "normal" });
    expect(send).toHaveBeenCalledWith(NOTIFY_QUEUE_OPTIONS.name, expect.objectContaining({ messageId: "m1", urgency: "normal" }));
    await expect(enqueueNotifyJob({ send }, { messageId: "legacy" })).rejects.toThrow(/requires/);
  });
});
