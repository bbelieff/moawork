/**
 * 수동 계약 체크리스트 — 비대면·대면 상담 «각각» 에 같은 4단계를 둔다.
 *
 *  1. contract_sent — 계약서 송부 (발신: 워크스페이스 회사 → 수신: 고객사)
 *  2. signed_copy_sent — 서명본 발송 (발신: 워크스페이스 회사 → 수신: 고객사)
 *  3. counterparty_signature_confirmed — 상대 서명 확인
 *  4. deposit_confirmed — 착수금 입금 확인
 *
 * 규칙:
 * - 순차 확인. 앞 단계가 끝나기 전에는 뒤를 확인할 수 없다.
 * - 앞 단계의 확인을 취소하면, 그 뒤에 확인됐던 단계들은 함께 무효가 된다
 *   (기록을 지우지 않고 «무효됨» 사건으로 남긴다).
 * - 이 체크는 «사람이 직접 확인했다» 는 기록일 뿐이다. 실제 외부 발송·수신·입금을
 *   추론하거나 자동으로 채우지 않는다. 자동 완료 없음.
 * - 각 확인에는 행위자(actor)와 시각을 남기고, 변경 전후(before/after)를
 *   히스토리에 한 사건으로 기록한다(승인 조건 7).
 */

import { ConsultationError } from "./errors";

export const CHECKLIST_STEPS = [
  "contract_sent",
  "signed_copy_sent",
  "counterparty_signature_confirmed",
  "deposit_confirmed",
] as const;
export type ChecklistStep = (typeof CHECKLIST_STEPS)[number];

export const CHECKLIST_LABEL: Record<ChecklistStep, string> = {
  contract_sent: "계약서 송부",
  signed_copy_sent: "서명본 발송",
  counterparty_signature_confirmed: "상대 서명 확인",
  deposit_confirmed: "착수금 입금 확인",
};

/** 발신·수신 방향 고지 — 실제 발송을 수행한다는 뜻이 아니다. */
export const CHECKLIST_DIRECTION: Record<ChecklistStep, string> = {
  contract_sent: "워크스페이스 회사 → 고객사 (수동 확인)",
  signed_copy_sent: "워크스페이스 회사 → 고객사 (수동 확인)",
  counterparty_signature_confirmed: "고객사 서명을 사람이 직접 확인",
  deposit_confirmed: "입금을 사람이 직접 확인 (자동 조회 없음)",
};

export interface StepState {
  confirmed: boolean;
  actorId: string | null;
  at: string | null;
}

export type ChecklistState = Record<ChecklistStep, StepState>;

export interface ChecklistEvent {
  step: ChecklistStep;
  before: boolean;
  after: boolean;
  /** 확인·취소·무효 중 무엇인가. */
  kind: "confirmed" | "unconfirmed" | "invalidated";
  actorId: string;
  at: string;
}

export function blankChecklist(): ChecklistState {
  return {
    contract_sent: { confirmed: false, actorId: null, at: null },
    signed_copy_sent: { confirmed: false, actorId: null, at: null },
    counterparty_signature_confirmed: { confirmed: false, actorId: null, at: null },
    deposit_confirmed: { confirmed: false, actorId: null, at: null },
  };
}

export function isChecklistStep(value: string): value is ChecklistStep {
  return (CHECKLIST_STEPS as readonly string[]).includes(value);
}

/** 앞 단계가 모두 확인됐을 때만 이 단계를 확인할 수 있다. */
export function assertConfirmable(state: ChecklistState, step: ChecklistStep): void {
  const index = CHECKLIST_STEPS.indexOf(step);
  const missing = CHECKLIST_STEPS.slice(0, index).filter((prior) => !state[prior].confirmed);
  if (missing.length > 0) {
    throw new ConsultationError(
      "checklist_blocked",
      `«${CHECKLIST_LABEL[step]}» 전에 «${missing.map((key) => CHECKLIST_LABEL[key]).join("», «")}» 을 먼저 확인해 주세요.`,
      { field: step, echo: { step } },
    );
  }
}

export function confirmStep(
  state: ChecklistState,
  step: ChecklistStep,
  actorId: string,
  at: string,
): { state: ChecklistState; event: ChecklistEvent } {
  assertConfirmable(state, step);
  const before = state[step].confirmed;
  const next: ChecklistState = {
    ...state,
    [step]: { confirmed: true, actorId, at },
  };
  return {
    state: next,
    event: { step, before, after: true, kind: "confirmed", actorId, at },
  };
}

/**
 * 확인 취소 — 이 단계와 그 뒤에 확인됐던 단계들을 함께 무효화한다.
 * 기록은 지우지 않고 invalidation 사건으로 남긴다.
 */
export function unconfirmStep(
  state: ChecklistState,
  step: ChecklistStep,
  actorId: string,
  at: string,
): { state: ChecklistState; events: ChecklistEvent[] } {
  const index = CHECKLIST_STEPS.indexOf(step);
  const next: ChecklistState = { ...state };
  const events: ChecklistEvent[] = [];
  for (const key of CHECKLIST_STEPS.slice(index)) {
    const before = next[key].confirmed;
    if (!before) continue;
    next[key] = { confirmed: false, actorId: null, at: null };
    events.push({
      step: key,
      before,
      after: false,
      kind: key === step ? "unconfirmed" : "invalidated",
      actorId,
      at,
    });
  }
  void index;
  return { state: next, events };
}

export function isChecklistComplete(state: ChecklistState): boolean {
  return CHECKLIST_STEPS.every((step) => state[step].confirmed);
}

/** 미완료 사유 목록 — 인계 차단 화면이 그대로 보여준다. */
export function incompleteSteps(state: ChecklistState): ChecklistStep[] {
  return CHECKLIST_STEPS.filter((step) => !state[step].confirmed);
}
