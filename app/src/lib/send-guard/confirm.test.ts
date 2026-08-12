/**
 * BBE-148 — ★ 이 파일이 완주 조건 「확인 없이는 아무 요청도 나가지 않는다」의 증명이다.
 *
 * 확인을 우회하는 길을 하나씩 막았는지 본다. 그리고 이 전체 흐름을 끝까지 돌려도
 * **네트워크 호출이 0건**임을 fetch 를 감시해 확인한다 — 「실제 발송 0건」의 증거다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertDispatchAllowed,
  batchKeyFor,
  confirmSend,
  DISPATCH_DISABLED_REASON,
  SEND_DISPATCH_ENABLED,
} from "./confirm";
import { planSend } from "./plan";
import { confirmRequestedEntry, requestedEntries } from "./history";
import type { SendConfirmation, SendPlan, SendPlanInput, SendTarget } from "./types";

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
    column: { key: "color8", label: "미팅확정 메세지" },
    value: "보내기기",
    targets,
    senderName: "우리회사",
  };
  return planSend(input)!;
}

function confirmationFor(plan: SendPlan, over: Partial<SendConfirmation> = {}): SendConfirmation {
  return {
    planFingerprint: plan.fingerprint,
    acknowledgedCount: plan.sendable.length,
    typedCount: plan.requiresTypedCount ? plan.sendable.length : undefined,
    actorId: "user-1",
    actorName: "담당자",
    confirmedAt: "2026-08-12T09:00:00.000Z",
    ...over,
  };
}

describe("★ 확인 없이는 요청이 만들어지지 않는다", () => {
  it("확인이 아예 없으면 거부한다", () => {
    const result = confirmSend(makePlan(), null);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("확인 없음");
  });

  it("확인한 뒤 계획이 바뀌면 거부한다 — 확인한 것과 나가는 것이 어긋날 수 없다", () => {
    const shown = makePlan();
    const confirmation = confirmationFor(shown);
    // 사람이 확인하는 사이에 대상이 2건으로 늘었다.
    const nowPlan = makePlan([target({ itemId: "a" }), target({ itemId: "b" })]);
    const result = confirmSend(nowPlan, confirmation);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("지문 불일치");
  });

  it("되돌려준 건수가 화면이 보여 준 수와 다르면 거부한다", () => {
    const plan = makePlan();
    const result = confirmSend(plan, confirmationFor(plan, { acknowledgedCount: 99 }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("건수 불일치");
  });

  it("대량인데 건수를 직접 입력하지 않으면 거부한다", () => {
    const plan = makePlan([target({ itemId: "a" }), target({ itemId: "b" })]);
    expect(plan.requiresTypedCount).toBe(true);
    expect(confirmSend(plan, confirmationFor(plan, { typedCount: undefined })).ok).toBe(false);
    const wrong = confirmSend(plan, confirmationFor(plan, { typedCount: 3 }));
    expect(wrong.ok).toBe(false);
    expect(wrong.ok === false && wrong.reason).toBe("건수 직접 입력 필요");
  });

  it("보낼 건이 0이면 거부한다", () => {
    const plan = makePlan([target({ phone: null })]);
    const result = confirmSend(plan, confirmationFor(plan));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("보낼 건 없음");
  });
});

describe("확인을 다 지나면 요청이 만들어진다", () => {
  it("1건 — 확인 하나로 통과", () => {
    const plan = makePlan();
    const result = confirmSend(plan, confirmationFor(plan));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.targets).toHaveLength(1);
    expect(result.request.templateCode).toBe("meeting-confirmed");
    expect(result.request.estimatedCostKrw).toBe(plan.estimatedCostKrw);
    expect(result.request.confirmedBy).toEqual({ actorId: "user-1", actorName: "담당자" });
    expect(result.request.planFingerprint).toBe(plan.fingerprint);
  });

  it("대량 — 건수를 정확히 입력하면 통과", () => {
    const plan = makePlan([target({ itemId: "a" }), target({ itemId: "b" })]);
    const result = confirmSend(plan, confirmationFor(plan, { typedCount: 2 }));
    expect(result.ok).toBe(true);
  });

  it("같은 확인은 같은 배치다 — 재시도해도 두 번 나가지 않는다", () => {
    const plan = makePlan();
    const a = confirmSend(plan, confirmationFor(plan));
    const b = confirmSend(plan, confirmationFor(plan));
    expect(a.ok && b.ok && a.request.batchKey).toBe(batchKeyFor(plan));
    expect(a.ok && b.ok && a.request.batchKey === b.request.batchKey).toBe(true);
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

describe("★ 실제 발송 0건 — 흐름 전체를 돌려도 네트워크가 열리지 않는다", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchSpy.mockReset();
  });

  it("계획 → 이력 → 확인 → 요청 → 이력 을 끝까지 돌려도 fetch 호출이 0이다", () => {
    const plan = makePlan([target({ itemId: "a" }), target({ itemId: "b" })]);
    confirmRequestedEntry(plan, { actorId: "user-1", actorName: "담당자" }, "2026-08-12T09:00:00.000Z");
    const result = confirmSend(plan, confirmationFor(plan, { typedCount: 2 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entries = requestedEntries(plan, result.request);
    expect(entries).toHaveLength(3); // 배치 1 + 건별 2

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
