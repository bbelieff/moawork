import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LockBlockedDialog } from "./LockBlockedDialog";
import type { LockCondition } from "@/lib/automation/lock";

function condition(over: Partial<LockCondition> = {}): LockCondition {
  return {
    key: "seal_approval",
    label: "대표 직인 승인",
    satisfied: false,
    currentValueLabel: "대기",
    ...over,
  };
}

describe("LockBlockedDialog", () => {
  it("미충족 조건이 없으면 아무것도 그리지 않는다(조용한 실패 반대 방향 가드)", () => {
    const html = renderToStaticMarkup(
      <LockBlockedDialog
        unmet={[]}
        onNavigateToCondition={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(html).toBe("");
  });

  it("무엇이 빠졌는지와 어디를 눌러 채우는지를 함께 보여준다", () => {
    const html = renderToStaticMarkup(
      <LockBlockedDialog
        unmet={[condition()]}
        onNavigateToCondition={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(html).toContain("아직 넘길 수 없습니다");
    expect(html).toContain("대표 직인 승인");
    expect(html).toContain("대표 직인 승인 = 대기");
    expect(html).toContain("대표 직인 승인 채우러 가기");
  });

  it("onRequestApproval 이 있으면 요청 보내기 보조 액션도 함께 뜬다", () => {
    const html = renderToStaticMarkup(
      <LockBlockedDialog
        unmet={[condition()]}
        onNavigateToCondition={vi.fn()}
        onRequestApproval={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(html).toContain("대표 직인 승인 요청 보내기");
  });

  it("onRequestApproval 이 없으면 요청 보내기 버튼을 그리지 않는다", () => {
    const html = renderToStaticMarkup(
      <LockBlockedDialog
        unmet={[condition()]}
        onNavigateToCondition={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(html).not.toContain("요청 보내기");
  });

  it("조건이 여러 개면 각각 «채우러 가기» 버튼을 따로 그린다", () => {
    const html = renderToStaticMarkup(
      <LockBlockedDialog
        unmet={[
          condition({ key: "a", label: "A조건", currentValueLabel: "미충족" }),
          condition({ key: "b", label: "B조건", currentValueLabel: "미충족" }),
        ]}
        onNavigateToCondition={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(html).toContain("A조건 채우러 가기");
    expect(html).toContain("B조건 채우러 가기");
    expect(html).toContain("조건 2개가 모두 충족돼야");
  });
});
