/**
 * BBE-148 — 이력. 「언제 · 누가 · 무엇을」이 빠짐없이 남는지 본다.
 * 나간 것만이 아니라 «막힌 것 · 취소한 것» 도 남긴다.
 */
import { describe, expect, it } from "vitest";
import { confirmSend } from "./confirm";
import { blockedEntry, confirmCancelledEntry, confirmRequestedEntry, requestedEntries } from "./history";
import { planSend } from "./plan";
import { createMemoryTicketStore, issueConfirmationTicket } from "./ticket";
import type { SendPlan, SendRequest, SendTarget } from "./types";

const ACTOR = { actorId: "user-1", actorName: "담당자" };
const AT = "2026-08-12T09:00:00.000Z";
const NOW = Date.UTC(2026, 7, 12, 9, 0, 0);

/** 확인 화면을 지난 것처럼 만들어 요청을 얻는다. 이력 테스트의 관심사는 그 뒤부터다. */
function requestFor(plan: SendPlan, typedCount?: number): SendRequest {
  const store = createMemoryTicketStore();
  const ticket = issueConfirmationTicket(store, plan, ACTOR.actorId, NOW);
  const result = confirmSend(
    plan,
    {
      ticketId: ticket.id,
      planFingerprint: plan.fingerprint,
      acknowledgedCount: plan.sendable.length,
      typedCount,
      actorId: ACTOR.actorId,
      actorName: ACTOR.actorName,
      confirmedAt: AT,
    },
    store,
    NOW,
  );
  if (!result.ok) throw new Error(`요청이 만들어지지 않았다: ${result.reason}`);
  return result.request;
}

function makePlan(targets: SendTarget[]): SendPlan {
  return planSend({
    orgId: "org-1",
    boardId: "board-1",
    column: { key: "consult1_notice", label: "1차 상담 안내" },
    value: "1차 상담완료",
    targets,
    senderName: "우리회사",
  })!;
}

const one: SendTarget = {
  itemId: "item-1",
  title: "가나다상사",
  phone: "010-1234-5678",
  fields: { 대표자명: "홍길동" },
};

describe("이력 항목", () => {
  it("확인 화면을 띄운 것도 남는다 — 아직 나간 것은 없다", () => {
    const entry = confirmRequestedEntry(makePlan([one]), ACTOR, AT);
    expect(entry.event).toBe("확인 요청");
    expect(entry.occurredAt).toBe(AT);
    expect(entry.actorName).toBe("담당자");
    expect(entry.summary).toContain("«1차 상담 안내»");
    expect(entry.summary).toContain("보낼 1건");
    expect(entry.summary).toContain("22원");
  });

  it("제외 사유를 요약에 셈해 넣는다", () => {
    const plan = makePlan([one, { ...one, itemId: "b", title: "번호없음", phone: null }]);
    const entry = confirmRequestedEntry(plan, ACTOR, AT);
    expect(entry.excludedCount).toBe(1);
    expect(entry.summary).toContain("제외 번호 없음 1건");
  });

  it("사람이 닫으면 «나간 건 없음» 이 남는다", () => {
    const entry = confirmCancelledEntry(makePlan([one]), ACTOR, AT);
    expect(entry.event).toBe("확인 취소");
    expect(entry.summary).toContain("나간 건 없습니다");
  });

  it("게이트가 막으면 왜 막혔는지가 본문이다", () => {
    const entry = blockedEntry(makePlan([one]), ACTOR, AT, "지문 불일치", "대상이 바뀌었습니다.");
    expect(entry.event).toBe("발송 차단");
    expect(entry.summary).toContain("지문 불일치");
    expect(entry.summary).toContain("대상이 바뀌었습니다.");
  });
});

describe("발송 요청 이력 — 각 건의 히스토리에 남는다", () => {
  it("배치 1줄 + 건별 1줄씩", () => {
    const plan = makePlan([one, { ...one, itemId: "item-2", title: "라마바산업" }]);
    const request = requestFor(plan, 2);

    const entries = requestedEntries(plan, request);
    expect(entries.map((e) => e.itemId)).toEqual([null, "item-1", "item-2"]);
    expect(entries[0].summary).toContain("2건 발송을 요청했습니다");
    expect(entries[0].summary).toContain(request.batchKey);
    // 건별 줄에는 가린 번호만 들어간다 — 원문 번호는 이력에도 남기지 않는다.
    expect(entries[1].summary).toContain("010-1234-••••");
    expect(entries[1].summary).not.toContain("5678");
    expect(entries[1].estimatedCostKrw).toBe(22);
    expect(entries.every((e) => e.actorName === "담당자" && e.occurredAt === AT)).toBe(true);
  });

  it("배치 한 줄만 원하면 perTarget=false", () => {
    const plan = makePlan([one]);
    expect(requestedEntries(plan, requestFor(plan), false)).toHaveLength(1);
  });
});
