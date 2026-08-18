import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  checkNewItemTitle,
  NEW_ITEM_TITLE_MAX,
  planNewItemSubmit,
} from "@/lib/boards/add-item-validation";

vi.mock("@/app/(app)/boards/actions", () => ({ addItemAction: () => {} }));

import { AddItemForm } from "./AddItemForm";

// BBE-171 — 총괄 실측: 「새 항목 눌렀을 때 채워야 할 필드가 안 보이고 직관적이지 않다」.
//
// ★ 이 부품은 «모든 보드» 가 쓴다(BoardHeader 팝오버 · GroupTable 인라인 행).
//   신규리드(22컬럼)·컨택·계약업무·공지가 함께 바뀐다. 그래서 컬럼 수에 의존하는
//   규칙을 넣지 않았고, 테스트도 두 variant 를 «같은 기준» 으로 잰다.
//
// 검증 환경: jsdom 이 없어 클릭을 흉내낼 수 없다. 그래서
//   (a) 판정은 순수 함수로 떼어 실패 경로까지 직접 부르고
//   (b) 표시는 renderToStaticMarkup 으로 «화면에 무엇이 나오는가» 를 잰다.

const popover = () => renderToStaticMarkup(
  <AddItemForm boardId="b1" variant="popover" groups={[{ id: "g1", name: "1그룹" }]} />,
);
const inline = () => renderToStaticMarkup(
  <AddItemForm boardId="b1" variant="inline" groupId="g1" />,
);

describe("checkNewItemTitle — 판정", () => {
  it("이름이 있으면 통과하고 앞뒤 공백을 다듬는다", () => {
    expect(checkNewItemTitle("  모아상사  ")).toEqual({ ok: true, title: "모아상사" });
  });

  it("★ 빈 값·공백만은 거부한다", () => {
    for (const raw of ["", "   ", "\t", null, undefined]) {
      const verdict = checkNewItemTitle(raw);
      expect(verdict.ok, JSON.stringify(raw)).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toBe("empty");
    }
  });

  it("★ 문구가 «무엇을 어떻게» 를 말한다 — 브라우저 기본 문구가 아니다", () => {
    const verdict = checkNewItemTitle("");
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    // 브라우저 기본 말풍선 문구를 그대로 쓰지 않는다.
    expect(verdict.message).not.toContain("이 입력란을 작성하세요");
    // 무엇을 넣는지 + 나머지는 나중에 채워도 된다는 사실
    expect(verdict.message).toContain("업체명");
    expect(verdict.message).toContain("나중에");
  });

  it("서버 상한(300)과 같은 경계를 쓴다", () => {
    expect(NEW_ITEM_TITLE_MAX).toBe(300);
    expect(checkNewItemTitle("가".repeat(300)).ok).toBe(true);
    const over = checkNewItemTitle("가".repeat(301));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toBe("too_long");
  });
});

// ★ 카드가 요구한 「오류 칸으로 자동 스크롤 + 포커스」는 jsdom 이 없어 클릭으로 잴 수 없다.
//   그래서 «무엇을 할지» 를 순수 값으로 내보내고, 그 값이 살아 있는지를 잰다.
//   (이 계획을 컴포넌트가 실제로 적용하는지는 이 테스트가 증명하지 않는다 — ⑦ 이 본다.)
describe("planNewItemSubmit — 제출 순간의 계획", () => {
  it("이름이 있으면 제출하고 아무것도 방해하지 않는다", () => {
    expect(planNewItemSubmit("모아상사")).toEqual({
      submit: true,
      error: null,
      scrollToField: false,
      focusField: false,
    });
  });

  it("★ 비어 있으면 제출하지 않고, 그 칸으로 «화면을 옮기고 포커스» 한다", () => {
    const plan = planNewItemSubmit("   ");
    expect(plan.submit).toBe(false);
    expect(plan.scrollToField).toBe(true);
    expect(plan.focusField).toBe(true);
    expect(plan.error).toBeTruthy();
  });

  it("★ 성공하면 이전 오류를 지운다 — 판정이 바뀌면 표시도 바뀐다", () => {
    expect(planNewItemSubmit("모아상사").error).toBeNull();
  });
});

describe("AddItemForm 렌더 — 두 variant 가 같은 규칙을 따른다", () => {
  it("★ native 검증을 쓰지 않는다 — required 없음 · noValidate 있음", () => {
    for (const [name, html] of [["popover", popover()], ["inline", inline()]] as const) {
      // required 가 남아 있으면 브라우저 말풍선이 다시 뜬다(뷰포트 밖이면 안 보인다).
      expect(html, name).not.toMatch(/\srequired(\s|=|>)/u);
      expect(html, name).toContain("noValidate");
    }
  });

  it("★ 제출 «전에» 필수임이 화면에 보인다", () => {
    for (const [name, html] of [["popover", popover()], ["inline", inline()]] as const) {
      expect(html, name).toContain('aria-required="true"');
      expect(html, name).toContain("(필수)");
      // 그리고 «이름만 넣으면 끝» 이라는 사실도 제출 전에 보인다.
      expect(html, name).toContain("이름만 입력하면 등록돼요");
    }
  });

  it("★ 오류가 없을 때는 alert 를 그리지 않는다 — 미리 빨갛게 칠하지 않는다", () => {
    for (const [name, html] of [["popover", popover()], ["inline", inline()]] as const) {
      expect(html, name).not.toContain('role="alert"');
      expect(html, name).not.toContain('data-testid="add-item-error"');
      expect(html, name).not.toContain('aria-invalid="true"');
    }
  });

  it("두 자리 모두 boardId 를 실어 보낸다", () => {
    expect(popover()).toContain('name="boardId"');
    expect(inline()).toContain('name="boardId"');
  });

  it("인라인은 자기 그룹에 묶이고, 팝오버는 그룹을 고른다", () => {
    expect(inline()).toContain('name="groupId"');
    expect(inline()).not.toContain("<select");
    expect(popover()).toContain("<select");
    expect(popover()).toContain("1그룹");
  });

  it("이름 칸에 접근성 이름이 있다", () => {
    expect(popover()).toContain('aria-label="항목 이름 (필수)"');
    expect(inline()).toContain('aria-label="새 항목 이름 (필수)"');
  });
});
