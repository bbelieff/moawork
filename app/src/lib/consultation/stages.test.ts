import { describe, expect, it } from "vitest";
import { ConsultationError } from "./errors";
import {
  assertSchedulable,
  assertStageTransition,
  canRequestHandoff,
  nextConsultationStages,
} from "./stages";

describe("상담 보기 전환", () => {
  it("신규리드는 상담 전이가 아니라 정식 이전의 자리다", () => {
    expect(nextConsultationStages("new_lead")).toEqual([]);
    expect(nextConsultationStages("remote")).toEqual(["inperson"]);
    expect(nextConsultationStages("inperson")).toEqual(["remote"]);
    expect(() => assertStageTransition("new_lead", "remote")).toThrow(ConsultationError);
    expect(() => assertStageTransition("remote", "inperson")).not.toThrow();
    expect(() => assertStageTransition("inperson", "remote")).not.toThrow();
    expect(() => assertStageTransition("new_lead", "inperson")).toThrow(ConsultationError);
  });

  it("대면 강제 없음 — 비대면에서 직접 인계 요청이 가능하다", () => {
    expect(canRequestHandoff("remote")).toBe(true);
    expect(canRequestHandoff("inperson")).toBe(true);
    expect(canRequestHandoff("new_lead")).toBe(false);
  });

  it("일정 누락은 입력을 보존한 채 해당 필드를 가리킨다", () => {
    try {
      assertSchedulable({ meetingAt: null, assigneeId: "user-1" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConsultationError);
      const typed = error as ConsultationError;
      expect(typed.code).toBe("validation");
      expect(typed.field).toBe("meetingAt");
      expect(typed.echo).toMatchObject({ meetingAt: null, assigneeId: "user-1" });
    }
    try {
      assertSchedulable({ meetingAt: "2026-10-01T10:00:00+09:00", assigneeId: "  " });
      expect.unreachable();
    } catch (error) {
      expect((error as ConsultationError).field).toBe("assigneeId");
      expect((error as ConsultationError).echo).toMatchObject({
        meetingAt: "2026-10-01T10:00:00+09:00",
      });
    }
    expect(() =>
      assertSchedulable({ meetingAt: "not-a-date", assigneeId: "user-1" }),
    ).toThrow(ConsultationError);
  });
});
