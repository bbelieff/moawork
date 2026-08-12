/**
 * BBE-148 — 확인 화면 재료. 「누구에게 · 몇 건 · 무슨 문구 · 얼마」가 맞는지 고정한다.
 */
import { describe, expect, it } from "vitest";
import { messageIdempotencyKey } from "@/lib/messaging";
import { DEFAULT_UNIT_COST_KRW, maskPhone, planSend } from "./plan";
import type { SendPlanInput, SendTarget } from "./types";

function target(over: Partial<SendTarget> = {}): SendTarget {
  return {
    itemId: "item-1",
    title: "가나다상사",
    phone: "010-1234-5678",
    fields: { 대표자명: "홍길동" },
    ...over,
  };
}

function input(over: Partial<SendPlanInput> = {}): SendPlanInput {
  return {
    orgId: "org-1",
    boardId: "board-1",
    column: { key: "color8", label: "미팅확정 메세지" },
    value: "보내기기",
    targets: [target()],
    senderName: "우리회사",
    ...over,
  };
}

describe("발송 계획을 세우는 조건", () => {
  it("발송 칸이 아니면 계획이 없다 — 평소대로 저장하면 된다", () => {
    expect(planSend(input({ column: { key: "___6", label: "계약금" }, value: "100" }))).toBeNull();
  });

  it("발송을 일으키지 않는 값이면 계획이 없다", () => {
    expect(planSend(input({ value: "미팅 미지정" }))).toBeNull();
    expect(planSend(input({ value: null }))).toBeNull();
  });
});

describe("누구에게 — 못 보내는 건을 따로 셈한다", () => {
  it("번호 없음·형식 오류·수신 거부·이미 보냄을 사유별로 가른다", () => {
    const sentKey = messageIdempotencyKey({
      orgId: "org-1",
      entityId: "item-5",
      columnKey: "color8",
      value: "보내기기",
    });
    const plan = planSend(
      input({
        targets: [
          target({ itemId: "item-1", title: "보낼곳" }),
          target({ itemId: "item-2", title: "번호없음", phone: null }),
          target({ itemId: "item-3", title: "형식오류", phone: "12" }),
          target({ itemId: "item-4", title: "거부", phone: "010-9999-0000" }),
          target({ itemId: "item-5", title: "이미보냄" }),
        ],
        optedOutPhoneDigits: new Set(["01099990000"]),
        alreadySentKeys: new Set([sentKey]),
      }),
    )!;

    expect(plan.requestedCount).toBe(5);
    expect(plan.sendable.map((t) => t.itemId)).toEqual(["item-1"]);
    expect(plan.excluded).toEqual([
      { itemId: "item-2", title: "번호없음", reason: "번호 없음" },
      { itemId: "item-3", title: "형식오류", reason: "번호 형식 오류" },
      { itemId: "item-4", title: "거부", reason: "수신 거부" },
      { itemId: "item-5", title: "이미보냄", reason: "이미 보냄" },
    ]);
  });

  it("번호는 가려서 화면에 올린다 — 원문을 뿌리지 않는다", () => {
    const plan = planSend(input())!;
    expect(plan.sendable[0].phoneMasked).toBe("010-1234-••••");
    expect(plan.sendable[0].phoneMasked).not.toContain("5678");
    expect(maskPhone("0212345678")).toBe("02-1234-••••");
    expect(maskPhone("0311234567")).toBe("031123-••••");
  });
});

describe("얼마 — 비용은 «보낼 건» 에만 붙는다", () => {
  it("제외된 건에는 비용을 매기지 않는다", () => {
    const plan = planSend(
      input({
        targets: [target({ itemId: "a" }), target({ itemId: "b" }), target({ itemId: "c", phone: null })],
      }),
    )!;
    expect(plan.sendable).toHaveLength(2);
    expect(plan.unitCostKrw).toBe(DEFAULT_UNIT_COST_KRW);
    expect(plan.estimatedCostKrw).toBe(2 * DEFAULT_UNIT_COST_KRW);
  });
});

describe("무슨 문구 — 변수까지 치환된 실제 문장", () => {
  it("자리표시자가 남지 않는다", () => {
    const plan = planSend(input())!;
    expect(plan.previewText).toContain("우리회사");
    expect(plan.previewText).toContain("가나다상사");
    expect(plan.previewText).toContain("홍길동");
    expect(plan.previewText).not.toMatch(/\{[^}]+\}/);
    expect(plan.previewMissingVariables).toEqual([]);
    expect(plan.previewFor).toBe("가나다상사");
  });

  it("값이 없는 변수는 «—» 로 남기고 그 사실을 알린다 — 조용히 지우지 않는다", () => {
    const plan = planSend(input({ targets: [target({ fields: {} })] }))!;
    expect(plan.previewText).toContain("—");
    expect(plan.previewMissingVariables).toEqual(["대표자명"]);
  });

  it("미리보기는 «보낼 첫 건» 을 쓴다 — 제외된 건이 아니다", () => {
    const plan = planSend(
      input({
        targets: [
          target({ itemId: "skip", title: "제외될곳", phone: null }),
          target({ itemId: "ok", title: "실제로갈곳" }),
        ],
      }),
    )!;
    expect(plan.previewFor).toBe("실제로갈곳");
    expect(plan.previewText).toContain("실제로갈곳");
  });
});

describe("건수 직접 입력 · 계획 지문", () => {
  it("1건은 확인만, 2건부터는 건수를 직접 입력하게 한다", () => {
    expect(planSend(input())!.requiresTypedCount).toBe(false);
    const two = planSend(input({ targets: [target({ itemId: "a" }), target({ itemId: "b" })] }))!;
    expect(two.requiresTypedCount).toBe(true);
  });

  it("같은 계획은 같은 지문이다", () => {
    expect(planSend(input())!.fingerprint).toBe(planSend(input())!.fingerprint);
  });

  it("대상·값·비용이 달라지면 지문이 달라진다", () => {
    const base = planSend(input())!.fingerprint;
    expect(planSend(input({ targets: [target({ itemId: "other" })] }))!.fingerprint).not.toBe(base);
    expect(planSend(input({ unitCostKrw: 30 }))!.fingerprint).not.toBe(base);
    expect(
      planSend(input({ column: { key: "color", label: "1차 상담 안내" }, value: "1차 상담완료" }))!
        .fingerprint,
    ).not.toBe(base);
  });

  it("제외만 남으면 보낼 건이 0이고 비용도 0이다", () => {
    const plan = planSend(input({ targets: [target({ phone: null })] }))!;
    expect(plan.sendable).toHaveLength(0);
    expect(plan.estimatedCostKrw).toBe(0);
    expect(plan.previewFor).toBeNull();
    expect(plan.requiresTypedCount).toBe(false);
  });
});
