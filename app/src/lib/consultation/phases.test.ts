import { describe, expect, it, vi } from "vitest";
import { blankChecklist } from "./checklist";
import { consultationPhase, CONSULTATION_PHASE_LABEL, INPERSON_PHASES, phaseLabel, phaseNeedsSchedule, REMOTE_PHASES } from "./phases";
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
  it("167: remote adds 부재 before 보류, in-person adds 미팅 후 고민 중 after 미팅취소; neither needs a schedule", () => {
    expect(REMOTE_PHASES.map((phase) => CONSULTATION_PHASE_LABEL[phase])).toEqual(["정보수집", "상담예정", "상담중", "부재", "보류", "거절", "재상담", "계약 진행"]);
    expect(INPERSON_PHASES.map((phase) => CONSULTATION_PHASE_LABEL[phase])).toEqual(["대면상담예약", "미팅완료", "미팅취소", "미팅 후 고민 중", "계약 진행"]);
    expect(phaseNeedsSchedule("absent")).toBe(false);
    expect(phaseNeedsSchedule("deliberating")).toBe(false);
  });
  it("167: 부재 label carries its origin; other phases ignore a stray origin", () => {
    expect(phaseLabel("absent", "scheduled")).toBe("부재 · 상담예정에서");
    expect(phaseLabel("absent", null)).toBe("부재");
    expect(phaseLabel("absent", "absent")).toBe("부재");
    expect(phaseLabel("consulting", "scheduled")).toBe("상담중");
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
