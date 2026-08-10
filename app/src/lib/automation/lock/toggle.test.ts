import { describe, expect, it } from "vitest";
import { decideLockToggle } from "./toggle";

const AT = "2026-08-10T16:20:00.000Z";

describe("decideLockToggle — 끄기(D66)", () => {
  it("사유 없이 끄려 하면 거부한다", () => {
    const result = decideLockToggle(
      { actor: "이대표", enabled: false, reason: null },
      AT,
    );
    expect(result).toEqual({
      ok: false,
      rejection: {
        code: "reason_required",
        message: "이중 잠금을 끄려면 이유를 입력해야 합니다.",
      },
    });
  });

  it("공백만 있는 사유도 거부한다", () => {
    const result = decideLockToggle(
      { actor: "이대표", enabled: false, reason: "   " },
      AT,
    );
    expect(result.ok).toBe(false);
  });

  it("사유가 있으면 통과하고 앞뒤 공백을 다듬은 감사 레코드를 만든다", () => {
    const result = decideLockToggle(
      { actor: "이대표", enabled: false, reason: "  담당자가 늘 직접 확인해서 필요 없음  " },
      AT,
    );
    expect(result).toEqual({
      ok: true,
      audit: {
        actor: "이대표",
        enabled: false,
        reason: "담당자가 늘 직접 확인해서 필요 없음",
        at: AT,
      },
    });
  });
});

describe("decideLockToggle — 켜기", () => {
  it("사유 없이 켜도 통과한다", () => {
    const result = decideLockToggle(
      { actor: "이대표", enabled: true, reason: null },
      AT,
    );
    expect(result).toEqual({
      ok: true,
      audit: { actor: "이대표", enabled: true, reason: "", at: AT },
    });
  });
});
