import { describe, expect, it } from "vitest";
import type { Ctx } from "@/lib/types";
import {
  accountInitial,
  buildAccountViewModel,
  displayAccountName,
  displayLoginEmail,
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
  it("현재 로그인 이메일을 계정 식별값으로 그대로 표시한다", () => {
    expect(displayLoginEmail("member@example.invalid")).toBe(
      "member@example.invalid",
    );
  });

  it("이메일과 이름이 없거나 잘못되면 안전한 한글 상태를 반환한다", () => {
    expect(displayLoginEmail(null)).toBe("로그인 이메일이 연결되지 않았어요");
    expect(displayAccountName("  ")).toBe("이름 미등록");
    expect(accountInitial(null)).toBe("나");
  });

  it.each([
    ["owner", "대표", true],
    ["admin", "관리자", false],
    ["team_lead", "팀장", false],
    ["member", "구성원", false],
  ] as const)("membership %s를 고객 역할로 번역한다", (role, label, canManage) => {
    const model = buildAccountViewModel(context({ role }));
    expect(model.roleLabel).toBe(label);
    expect(model.canManageCompany).toBe(canManage);
    expect(model.loginEmail).toBe("member@example.invalid");
  });

  /*
   * ★ 조사가 이름을 «따라오는지» 를 여기서 잰다 (#700).
   *
   *   `roleDescription` 은 이름을 문장에 «끼워 넣는» 유일한 자리인데,
   *   전에는 `${roleLabel(role)}로` 라고 박아 둬서 받침 있는 이름이 깨졌다:
   *       팀장 → 「팀장로 참여하고 있어요」 · 구성원 → 「구성원로 …」
   *   #699 가 「사원」을 「구성원」으로 바꿨지만 «둘 다 받침» 이라 계속 깨진 채였다.
   *
   * ★★ 그리고 이 시험이 «없어서» 그 결함이 오래 살아 있었다.
   *   `josa.test.ts` 는 조사 «모듈» 만 지킨다 — 그 모듈을 여기서 «부르는지» 는 못 본다.
   *   실측(검수 P2-4): 이 줄을 `${role}로` 로 되돌려도 727개 시험이 전부 초록이었다.
   *   그래서 «만드는 곳» 에 직접 붙인다. 역할이 늘면 위 표에 한 줄만 더하면 된다.
   */
  it.each([
    ["owner", "대표로 참여하고 있어요."],
    ["admin", "관리자로 참여하고 있어요."],
    ["team_lead", "팀장으로 참여하고 있어요."],
    ["member", "구성원으로 참여하고 있어요."],
  ] as const)("★ %s 의 소개 문장에 조사가 맞게 붙는다", (role, expected) => {
    expect(buildAccountViewModel(context({ role })).roleDescription).toBe(expected);
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
    expect(model.scopeLabel).toBe("회사 전체");
  });

  it("플랫폼 관리자가 아닌 멤버의 역할도 동일 규칙으로 표시된다", () => {
    const model = buildAccountViewModel(
      context({ role: "member", scope: "assigned", isPlatformAdmin: true }),
    );
    // 플랫폼 관리자라고 회사 역할이 올라가지도 않는다(두 축은 독립).
    expect(model.roleLabel).toBe("구성원");
    expect(model.canManageCompany).toBe(false);
    expect(model.scopeLabel).toBe("본인 담당분");
  });
});
