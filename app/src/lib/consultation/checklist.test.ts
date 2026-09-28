import { describe, expect, it } from "vitest";
import {
  blankChecklist,
  CHECKLIST_STEPS,
  confirmStep,
  incompleteSteps,
  isChecklistComplete,
  unconfirmStep,
} from "./checklist";
import { ConsultationError } from "./errors";

const ACTOR = "user-1";
const AT = "2026-09-25T00:00:00.000Z";

function confirmedAll() {
  let state = blankChecklist();
  for (const step of CHECKLIST_STEPS) {
    state = confirmStep(state, step, ACTOR, AT).state;
  }
  return state;
}

describe("수동 계약 체크리스트", () => {
  it("순서를 어기면 뒤 단계를 확인할 수 없다", () => {
    const state = blankChecklist();
    expect(() => confirmStep(state, "deposit_confirmed", ACTOR, AT)).toThrow(ConsultationError);
    expect(() => confirmStep(state, "signed_copy_sent", ACTOR, AT)).toThrow(ConsultationError);
    expect(isChecklistComplete(state)).toBe(false);
  });

  it("앞에서부터 순서대로 확인하면 모두 완료된다", () => {
    const state = confirmedAll();
    expect(isChecklistComplete(state)).toBe(true);
    expect(incompleteSteps(state)).toEqual([]);
    expect(state.deposit_confirmed).toMatchObject({ confirmed: true, actorId: ACTOR, at: AT });
  });

  it("앞 단계 취소를 뒤에 확인된 단계까지 함께 무효화하고 기록을 남긴다", () => {
    const full = confirmedAll();
    const { state, events } = unconfirmStep(full, "contract_sent", ACTOR, AT);
    expect(isChecklistComplete(state)).toBe(false);
    expect(incompleteSteps(state)).toHaveLength(4);
    expect(events.map((event) => [event.step, event.kind, event.before, event.after])).toEqual([
      ["contract_sent", "unconfirmed", true, false],
      ["signed_copy_sent", "invalidated", true, false],
      ["counterparty_signature_confirmed", "invalidated", true, false],
      ["deposit_confirmed", "invalidated", true, false],
    ]);
    for (const event of events) {
      expect(event.actorId).toBe(ACTOR);
      expect(event.at).toBe(AT);
    }
  });

  it("중간 단계 취소는 그 앞을 건드리지 않는다", () => {
    const full = confirmedAll();
    const { state, events } = unconfirmStep(full, "counterparty_signature_confirmed", ACTOR, AT);
    expect(state.contract_sent.confirmed).toBe(true);
    expect(state.signed_copy_sent.confirmed).toBe(true);
    expect(state.counterparty_signature_confirmed.confirmed).toBe(false);
    expect(state.deposit_confirmed.confirmed).toBe(false);
    expect(events.map((event) => event.kind)).toEqual(["unconfirmed", "invalidated"]);
  });

  it("확인하지 않은 단계 취소는 사건 없이 성공한다", () => {
    const { state, events } = unconfirmStep(blankChecklist(), "contract_sent", ACTOR, AT);
    expect(events).toEqual([]);
    expect(isChecklistComplete(state)).toBe(false);
  });

  it("자동 완료가 없다 — 외부 발송·입금을 추론하지 않는다", () => {
    // 확인 행위 없이는 어떤 상태 조합도 완료가 될 수 없다.
    expect(isChecklistComplete(blankChecklist())).toBe(false);
  });
});
