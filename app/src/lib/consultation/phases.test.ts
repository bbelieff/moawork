import { describe, expect, it, vi } from "vitest";
import { blankChecklist } from "./checklist";
import { consultationPhase } from "./phases";
import { setConsultationWorkflow } from "./service";

describe("consultation phases and uncertain workflow transport", () => {
  it("legacy phase inference preserves progress and never invents a completed meeting", () => {
    const checklist = blankChecklist();
    const base = { checklist, meetingAt: null, mode: "remote" };
    expect(consultationPhase(base)).toBe("information");
    expect(consultationPhase({ ...base, meetingAt: "2026-10-01T10:00Z" })).toBe("scheduled");
    expect(consultationPhase({ ...base, mode: "inperson" })).toBe("meeting_scheduled");
    checklist.contract_sent = { confirmed: true, actorId: "u", at: "2026-10-01T10:00Z" };
    expect(consultationPhase(base)).toBe("contract");
    expect(consultationPhase({ ...base, phase: "on_hold" })).toBe("on_hold");
  });
  const input = { orgId: "org", itemId: "item", requestId: "request-stable-156", expectedVersion: 3,
    mode: "remote", phase: "scheduled", meetingAt: "2026-10-01T10:00Z", assigneeId: "member", cancel: false };
  it("unknown RPC transport remains distinguishable from a settled CAS rejection", async () => {
    const rpc = vi.fn().mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValueOnce({ data: null, error: { code: "40001", message: "version conflict" } });
    await expect(setConsultationWorkflow({ rpc },input)).rejects.toMatchObject({ field: "unknown_result" });
    await expect(setConsultationWorkflow({ rpc },input)).rejects.toMatchObject({ field: "version" });
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
  });
});
