import { describe, expect, it } from "vitest";
import type { Ctx } from "@/lib/types";
import {
  accountInitial,
  buildAccountViewModel,
  displayAccountName,
  maskLoginEmail,
} from "./presentation";

function context(overrides: Partial<Ctx> = {}): Ctx {
  return {
    user: {
      id: "user-test",
      email: "member@example.invalid",
      name: "테스트 사용자",
      avatar_url: null,
      created_at: "2026-01-01T00:00:00.000Z",
    },
    org: {
      id: "org-test",
      name: "테스트 회사",
      plan_tier: "test",
      created_at: "2026-01-01T00:00:00.000Z",
    },
    role: "member",
    scope: "assigned",
    ...overrides,
  };
}

describe("account presentation", () => {
  it("로그인 이메일은 local 앞 두 글자만 남긴다", () => {
    expect(maskLoginEmail("member@example.invalid")).toBe(
      "me***@example.invalid",
    );
    expect(maskLoginEmail("a@example.invalid")).toBe("a***@example.invalid");
  });

  it("이메일과 이름이 없거나 잘못되면 안전한 한글 상태를 반환한다", () => {
    expect(maskLoginEmail(null)).toBe("로그인 이메일이 연결되지 않았어요");
    expect(maskLoginEmail("not-an-email")).toBe(
      "로그인 이메일을 안전하게 표시할 수 없어요",
    );
    expect(displayAccountName("  ")).toBe("이름 미등록");
    expect(accountInitial(null)).toBe("나");
  });

  it.each([
    ["owner", "대표", true],
    ["admin", "팀장", false],
    ["member", "사원", false],
  ] as const)("membership %s를 고객 역할로 번역한다", (role, label, canManage) => {
    const model = buildAccountViewModel(context({ role }));
    expect(model.roleLabel).toBe(label);
    expect(model.canManageCompany).toBe(canManage);
    expect(model.maskedEmail).not.toContain("member@example.invalid");
  });

  // 회귀 가드(P0): 플랫폼 관리자여도 **자기 회사 역할은 그대로 보인다**.
  // 과거엔 여기서 "회사 역할 확인 중"으로 가려 오너가 자기 회사를 관리하지 못했다.
  // role/scope 는 session.ts 의 두 경로 모두 검증된 org_members 행에서만 오므로
  // 추정이 아니라 사실이다 — 가릴 이유가 없다.
  it("플랫폼 관리자여도 실제 멤버십 역할을 그대로 보여준다", () => {
    const model = buildAccountViewModel(
      context({ role: "owner", scope: "all", isPlatformAdmin: true }),
    );
    expect(model.roleLabel).toBe("대표");
    expect(model.canManageCompany).toBe(true);
    expect(model.scopeLabel).toBe("회사 업무 전체");
  });

  it("플랫폼 관리자가 아닌 멤버의 역할도 동일 규칙으로 표시된다", () => {
    const model = buildAccountViewModel(
      context({ role: "member", scope: "assigned", isPlatformAdmin: true }),
    );
    // 플랫폼 관리자라고 회사 역할이 올라가지도 않는다(두 축은 독립).
    expect(model.roleLabel).toBe("사원");
    expect(model.canManageCompany).toBe(false);
    expect(model.scopeLabel).toBe("내게 배정된 업무");
  });
});
