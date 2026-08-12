/**
 * BBE-148 — 확인 화면 렌더 검증.
 *
 * 로컬 (app) 셸은 Supabase env 없이는 500 이라 브라우저로 이 화면까지 갈 수 없다
 * (기존 갭 — GroupTable.test.tsx 가 같은 이유로 같은 방식을 쓴다). 그래서 컴포넌트를
 * 직접 렌더해 markup 으로 고정한다. 눈으로 본 증거는 별도 하네스로 촬영한다.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { planSend } from "@/lib/send-guard";
import type { SendPlan, SendTarget } from "@/lib/send-guard";
import { SendConfirmDialog } from "./SendConfirmDialog";

function makePlan(targets: SendTarget[]): SendPlan {
  return planSend({
    orgId: "org-1",
    boardId: "board-1",
    column: { key: "color8", label: "미팅확정 메세지" },
    value: "보내기기",
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

function render(plan: SendPlan) {
  return renderToStaticMarkup(
    <SendConfirmDialog plan={plan} sendAction="/send" cancelAction="/cancel" senderLabel="우리회사" />,
  );
}

describe("확인 화면이 반드시 보여 주는 것", () => {
  const html = render(makePlan([one]));

  it("무엇이 바뀌는지 · 되돌릴 수 없다는 사실", () => {
    expect(html).toContain("되돌릴 수 없습니다");
    expect(html).toContain("«미팅확정 메세지»");
    expect(html).toContain("«보내기기»");
  });

  it("누구에게 — 이름과 가린 번호", () => {
    expect(html).toContain("누구에게");
    expect(html).toContain("가나다상사");
    expect(html).toContain("010-1234-••••");
  });

  it("번호 원문은 화면에 없다", () => {
    expect(html).not.toContain("5678");
    expect(html).not.toContain("01012345678");
  });

  it("몇 건 · 예상 비용", () => {
    expect(html).toContain("건 발송");
    expect(html).toContain("22원");
  });

  it("무슨 문구 — 자리표시자가 남지 않은 실제 문장", () => {
    expect(html).toContain("무슨 문구");
    expect(html).toContain("가나다상사 홍길동 대표님");
    expect(html).not.toMatch(/\{[^}]+\}/);
  });

  it("이력이 남는다는 사실을 화면에 적는다", () => {
    expect(html).toContain("각 건의 이력에 남습니다");
  });
});

describe("대량 — 한 겹 더", () => {
  const plan = makePlan([
    one,
    { ...one, itemId: "b", title: "라마바산업" },
    { ...one, itemId: "c", title: "번호없음", phone: null },
  ]);
  const html = render(plan);

  it("못 보내는 건을 사유별로 따로 셈해 보여준다", () => {
    expect(plan.excluded).toHaveLength(1);
    expect(html).toContain("번호 없음이라 빠짐");
    expect(html).toContain("조건에 걸린 건");
  });

  it("★ 확인 버튼은 건수를 직접 입력해야 눌린다 — JS 없이도 막힌다", () => {
    // required + pattern 은 브라우저 기본 폼 검증이라 JS 가 죽어도 제출을 막는다.
    expect(html).toContain('name="typedCount"');
    expect(html).toContain("required");
    expect(html).toContain('pattern="2"');
    expect(html).toContain("를 입력하세요");
    expect(html).toContain('title="2 를 그대로 입력하세요"');
  });

  it("확인 폼은 계획 지문과 건수를 그대로 되돌려준다 — 서버가 다시 맞춰 본다", () => {
    expect(html).toContain(`value="${plan.fingerprint}"`);
    expect(html).toContain('name="planFingerprint"');
    expect(html).toContain('name="acknowledgedCount"');
  });
});

describe("1건 — 건수 입력을 요구하지 않는다", () => {
  it("이름과 문구가 그대로 보이므로 확인 한 번으로 충분하다", () => {
    const html = render(makePlan([one]));
    expect(html).not.toContain('name="typedCount"');
    expect(html).toContain("1건 보내기");
  });
});

describe("보낼 건이 없으면 보낼 수 없다", () => {
  const html = render(makePlan([{ ...one, phone: null }]));

  it("버튼이 disabled 다", () => {
    expect(html).toContain("disabled");
    expect(html).toContain("보낼 건 없음");
    expect(html).toContain("보낼 수 있는 건이 없습니다");
  });

  it("나가지 않을 문장을 «실제로 나갈 문장» 이라고 띄우지 않는다", () => {
    expect(html).toContain("보낼 건이 없어 나갈 문장이 없습니다");
    expect(html).not.toContain("실제로 나갈 문장");
  });
});

describe("문구에 구멍이 있으면 확인 화면이 경고한다", () => {
  it("값이 없어 «—» 로 나가는 칸을 알린다", () => {
    const html = render(makePlan([{ ...one, fields: {} }]));
    expect(html).toContain("값이 없어 «—» 로 나가는 칸");
    expect(html).toContain("대표자명");
  });
});
