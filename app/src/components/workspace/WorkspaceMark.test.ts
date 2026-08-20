import { describe, expect, it } from "vitest";
import { workspaceInitial, workspaceNameHash, workspaceTone } from "./WorkspaceMark";

describe("WorkspaceMark", () => {
  it("한글은 한 글자, 영문은 두 글자 이니셜을 만든다", () => {
    expect(workspaceInitial("가나다 주식회사")).toBe("가");
    expect(workspaceInitial("MoaWork Lab")).toBe("MO");
  });

  it("법인 표기와 특수문자를 걷어내고 실제 이름을 사용한다", () => {
    expect(workspaceInitial("(주)엘에스")).toBe("엘");
    expect(workspaceInitial("주식회사 모아워크")).toBe("모");
    expect(workspaceInitial("🔥 샘플 회사")).toBe("샘");
  });

  it("이니셜로 쓸 문자가 없으면 최종 브랜드 폴백을 선택한다", () => {
    expect(workspaceInitial(" ")).toBeNull();
    expect(workspaceInitial("!!!")).toBeNull();
  });

  it("기존 브랜드 토큰 배정은 결정적이고 음수가 아니다", () => {
    const name = "샘플 회사";
    expect(workspaceNameHash(name)).toBe(workspaceNameHash(name));
    expect(workspaceNameHash(name)).toBeGreaterThanOrEqual(0);
    expect(["toneRecord", "toneAutomation", "tonePrimary"]).toContain(workspaceTone(name));
  });
});
