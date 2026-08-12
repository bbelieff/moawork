/**
 * BBE-148 — ★ 이 파일이 완주 조건 「확인 없이는 아무 요청도 나가지 않는다」의 증명이다.
 *
 * 확인을 우회하는 길을 하나씩 막았는지 본다. 그리고 이 전체 흐름을 끝까지 돌려도
 * **네트워크 호출이 0건**임을 fetch 를 감시해 확인한다 — 「실제 발송 0건」의 증거다.
 *
 * ⚠ 2026-08-12 독립 검수가 잡은 것 — 지문만으로는 위조를 못 막는다. 지문의 재료가 전부
 *   요청 자기 필드라 위조자가 스스로 계산해 넣을 수 있다. 아래
 *   「지문까지 정확히 계산한 위조」 케이스가 그 시나리오를 그대로 재현한다.
 *   막는 것은 확인표뿐이다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertDispatchAllowed,
  batchKeyFor,
  confirmSend,
  DISPATCH_DISABLED_REASON,
  isSelfConsistentRequest,
  SEND_DISPATCH_ENABLED,
} from "./confirm";
import { planFingerprint, planSend } from "./plan";
import { confirmRequestedEntry, requestedEntries } from "./history";
import {
  createMemoryTicketStore,
  issueConfirmationTicket,
  TICKET_TTL_MS,
  type ConfirmationTicketStore,
} from "./ticket";
import type { SendConfirmation, SendPlan, SendPlanInput, SendRequest, SendTarget } from "./types";

const NOW = Date.UTC(2026, 7, 12, 9, 0, 0);
const ACTOR = { actorId: "user-1", actorName: "담당자" };

function target(over: Partial<SendTarget> = {}): SendTarget {
  return {
    itemId: "item-1",
    title: "가나다상사",
    phone: "010-1234-5678",
    fields: { 대표자명: "홍길동" },
    ...over,
  };
}

function makePlan(targets: SendTarget[] = [target()]): SendPlan {
  const input: SendPlanInput = {
    orgId: "org-1",
    boardId: "board-1",
    column: { key: "consult1_notice", label: "1차 상담 안내" },
    value: "1차 상담완료",
    targets,
    senderName: "우리회사",
  };
  return planSend(input)!;
}

/** 확인 화면을 그린 것처럼 확인표를 발급하고, 사람이 그것을 그대로 되돌려준 상태를 만든다. */
function passThroughDialog(
  store: ConfirmationTicketStore,
  plan: SendPlan,
  over: Partial<SendConfirmation> = {},
): SendConfirmation {
  const ticket = issueConfirmationTicket(store, plan, ACTOR.actorId, NOW);
  return {
    ticketId: ticket.id,
    planFingerprint: plan.fingerprint,
    acknowledgedCount: plan.sendable.length,
    typedCount: plan.requiresTypedCount ? plan.sendable.length : undefined,
    actorId: ACTOR.actorId,
    actorName: ACTOR.actorName,
    confirmedAt: "2026-08-12T09:00:00.000Z",
    ...over,
  };
}

let store: ConfirmationTicketStore;
beforeEach(() => {
  store = createMemoryTicketStore();
});

describe("★ 확인 없이는 요청이 만들어지지 않는다", () => {
  it("확인이 아예 없으면 거부한다", () => {
    const result = confirmSend(makePlan(), null, store, NOW);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("확인 없음");
  });

  it("★ 확인 화면을 지나지 않으면 — 확인표가 없으면 — 거부한다", () => {
    const plan = makePlan();
    const neverShown: SendConfirmation = {
      ticketId: "내가-지어낸-확인표",
      planFingerprint: plan.fingerprint,
      acknowledgedCount: plan.sendable.length,
      actorId: ACTOR.actorId,
      actorName: ACTOR.actorName,
      confirmedAt: "2026-08-12T09:00:00.000Z",
    };
    const result = confirmSend(plan, neverShown, store, NOW);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("확인표 무효");
  });

  it("확인한 뒤 계획이 바뀌면 거부한다 — 확인한 것과 나가는 것이 어긋날 수 없다", () => {
    const shown = makePlan();
    const confirmation = passThroughDialog(store, shown);
    // 사람이 확인하는 사이에 대상이 2건으로 늘었다.
    const nowPlan = makePlan([target({ itemId: "a" }), target({ itemId: "b" })]);
    const result = confirmSend(nowPlan, confirmation, store, NOW);
    expect(result.ok).toBe(false);
    // 확인표는 «사람이 그 화면을 지났다» 만 증명한다(그건 사실이다).
    // «그 사이에 계획이 바뀌지 않았다» 는 지문이 따로 증명한다 — 두 겹이 각자 제 일을 한다.
    expect(result.ok === false && result.reason).toBe("지문 불일치");
  });

  it("되돌려준 건수가 화면이 보여 준 수와 다르면 거부한다", () => {
    const plan = makePlan();
    const result = confirmSend(plan, passThroughDialog(store, plan, { acknowledgedCount: 99 }), store, NOW);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("건수 불일치");
  });

  it("대량인데 건수를 직접 입력하지 않으면 거부한다", () => {
    const plan = makePlan([target({ itemId: "a" }), target({ itemId: "b" })]);
    expect(plan.requiresTypedCount).toBe(true);
    expect(confirmSend(plan, passThroughDialog(store, plan, { typedCount: undefined }), store, NOW).ok).toBe(
      false,
    );
    const wrong = confirmSend(plan, passThroughDialog(store, plan, { typedCount: 3 }), store, NOW);
    expect(wrong.ok).toBe(false);
    expect(wrong.ok === false && wrong.reason).toBe("건수 직접 입력 필요");
  });

  it("보낼 건이 0이면 거부한다", () => {
    const plan = makePlan([target({ phone: null })]);
    const result = confirmSend(plan, passThroughDialog(store, plan), store, NOW);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("보낼 건 없음");
  });
});

describe("★ 확인표는 1회용이다 — 같은 확인으로 두 번 보내지 못한다", () => {
  it("두 번째 호출은 거부한다", () => {
    const plan = makePlan();
    const confirmation = passThroughDialog(store, plan);
    expect(confirmSend(plan, confirmation, store, NOW).ok).toBe(true);
    const again = confirmSend(plan, confirmation, store, NOW);
    expect(again.ok).toBe(false);
    expect(again.ok === false && again.reason).toBe("확인표 무효");
  });

  it("시간이 지난 확인표는 거부한다", () => {
    const plan = makePlan();
    const confirmation = passThroughDialog(store, plan);
    const late = confirmSend(plan, confirmation, store, NOW + TICKET_TTL_MS + 1);
    expect(late.ok).toBe(false);
    expect(late.ok === false && late.reason).toBe("확인표 무효");
  });

  it("남의 확인표를 주워 쓰지 못한다", () => {
    const plan = makePlan();
    const confirmation = passThroughDialog(store, plan, { actorId: "다른사람" });
    const result = confirmSend(plan, confirmation, store, NOW);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("확인표 무효");
  });

  it("틀린 확인표를 반복해 찔러 볼 수 없다 — 손댄 확인표는 태워진다", () => {
    const plan = makePlan();
    const ticket = issueConfirmationTicket(store, plan, ACTOR.actorId, NOW);
    // 먼저 «다른 사람» 으로 한 번 찌른다 → 실패하지만 확인표는 태워진다.
    expect(
      store.consume({ id: ticket.id, planFingerprint: plan.fingerprint, actorId: "침입자", nowMs: NOW }),
    ).toBe(false);
    // 이제 진짜 주인이 와도 쓸 수 없다.
    expect(
      store.consume({ id: ticket.id, planFingerprint: plan.fingerprint, actorId: ACTOR.actorId, nowMs: NOW }),
    ).toBe(false);
  });
});

describe("확인을 다 지나면 요청이 만들어진다", () => {
  it("1건 — 확인 하나로 통과", () => {
    const plan = makePlan();
    const result = confirmSend(plan, passThroughDialog(store, plan), store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.targets).toHaveLength(1);
    expect(result.request.templateCode).toBe("consultation-first");
    expect(result.request.estimatedCostKrw).toBe(plan.estimatedCostKrw);
    expect(result.request.confirmedBy).toEqual({ actorId: "user-1", actorName: "담당자" });
    expect(result.request.planFingerprint).toBe(plan.fingerprint);
    expect(result.request.batchKey).toBe(batchKeyFor(plan));
  });

  it("대량 — 건수를 정확히 입력하면 통과", () => {
    const plan = makePlan([target({ itemId: "a" }), target({ itemId: "b" })]);
    const result = confirmSend(plan, passThroughDialog(store, plan, { typedCount: 2 }), store, NOW);
    expect(result.ok).toBe(true);
  });
});

describe("★ 발송 통로는 비활성이다 — BBE-30", () => {
  it("통로 상수가 false 다", () => {
    expect(SEND_DISPATCH_ENABLED).toBe(false);
  });

  it("실제 전송을 붙이려 하면 반드시 예외로 죽는다 — 조용히 나가는 길이 없다", () => {
    expect(() => assertDispatchAllowed()).toThrowError(DISPATCH_DISABLED_REASON);
  });
});

describe("자가일관 검사는 «내용이 바뀐 것» 만 잡는다 — 위조 탐지기가 아니다", () => {
  function issued(): SendRequest {
    const plan = makePlan();
    const result = confirmSend(plan, passThroughDialog(store, plan), store, NOW);
    if (!result.ok) throw new Error("요청이 만들어지지 않았다");
    return result.request;
  }

  it("정상 요청은 통과한다", () => {
    expect(isSelfConsistentRequest(issued())).toBe(true);
  });

  it("만들어진 뒤 대상이 바뀐 요청은 잡는다", () => {
    const request = issued();
    const tampered = {
      ...request,
      targets: [{ ...request.targets[0], itemId: "몰래-바꾼-건" }],
    } as SendRequest;
    expect(isSelfConsistentRequest(tampered)).toBe(false);
  });

  it("비용만 바꿔치기해도 잡는다", () => {
    expect(isSelfConsistentRequest({ ...issued(), estimatedCostKrw: 1 } as SendRequest)).toBe(false);
  });

  it("★ 지문까지 정확히 계산한 위조는 «잡지 못한다» — 이것이 이 검사의 한계다", () => {
    // 독립 검수가 실측한 시나리오를 그대로 고정한다. 이 검사에 위조 방어를 기대하면 안 된다.
    const fp = planFingerprint({
      orgId: "org-1",
      boardId: "board-1",
      columnKey: "consult1_notice",
      value: "1차 상담완료",
      templateCode: "consultation-first",
      itemIds: ["몰래-넣은-건"],
      estimatedCostKrw: 22,
    });
    const forged = {
      orgId: "org-1",
      boardId: "board-1",
      columnKey: "consult1_notice",
      value: "1차 상담완료",
      templateCode: "consultation-first",
      channel: "sms",
      targets: [
        {
          itemId: "몰래-넣은-건",
          title: "몰래",
          phoneDigits: "01000000000",
          phoneMasked: "010-0000-••••",
          idempotencyKey: "k",
        },
      ],
      estimatedCostKrw: 22,
      planFingerprint: fp,
      confirmedBy: { actorId: "없음", actorName: "확인한적없음" },
      confirmedAt: "2026-08-12T09:00:00.000Z",
      batchKey: fp.slice(0, 16),
    } as unknown as SendRequest;

    expect(isSelfConsistentRequest(forged)).toBe(true); // ← 통과해 버린다. 알고 고정한다.
  });

  it("★ 그러나 같은 위조가 확인표 관문은 넘지 못한다 — 요청이 아예 만들어지지 않는다", () => {
    const plan = makePlan();
    const forgedConfirmation: SendConfirmation = {
      ticketId: "지어낸-확인표",
      planFingerprint: plan.fingerprint, // 지문은 스스로 계산해 맞췄다
      acknowledgedCount: plan.sendable.length,
      actorId: "확인한적없음",
      actorName: "확인한적없음",
      confirmedAt: "2026-08-12T09:00:00.000Z",
    };
    const result = confirmSend(plan, forgedConfirmation, store, NOW);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("확인표 무효");
  });
});

describe("★ 실제 발송 0건 — 흐름 전체를 돌려도 네트워크가 열리지 않는다", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchSpy.mockReset();
  });

  it("계획 → 확인표 → 이력 → 확인 → 요청 → 이력 을 끝까지 돌려도 fetch 호출이 0이다", () => {
    const plan = makePlan([target({ itemId: "a" }), target({ itemId: "b" })]);
    const confirmation = passThroughDialog(store, plan, { typedCount: 2 });
    confirmRequestedEntry(plan, ACTOR, "2026-08-12T09:00:00.000Z");
    const result = confirmSend(plan, confirmation, store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entries = requestedEntries(plan, result.request);
    expect(entries).toHaveLength(3); // 배치 1 + 건별 2

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
