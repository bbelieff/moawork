import { describe, it, expect } from "vitest";
import {
  atLeast,
  isManager,
  isMemberRole,
  isMemberScope,
  roleLabel,
  roleLabelOrUnknown,
  scopeLabel,
  roleRank,
  MEMBER_ROLES,
  MEMBER_SCOPES,
} from "./roles";

describe("roleRank", () => {
  it("위계 순서대로 랭크를 매긴다 (owner>admin>member)", () => {
    expect(roleRank("owner")).toBeGreaterThan(roleRank("admin"));
    expect(roleRank("admin")).toBeGreaterThan(roleRank("member"));
  });

  it("멤버가 아니면(null/undefined) 0", () => {
    expect(roleRank(null)).toBe(0);
    expect(roleRank(undefined)).toBe(0);
  });
});

describe("atLeast", () => {
  it("동일 역할은 충족", () => {
    for (const r of MEMBER_ROLES) expect(atLeast(r, r)).toBe(true);
  });

  it("상위 역할은 하위 요구를 충족", () => {
    expect(atLeast("owner", "member")).toBe(true);
    expect(atLeast("admin", "member")).toBe(true);
    expect(atLeast("owner", "admin")).toBe(true);
  });

  it("하위 역할은 상위 요구를 충족하지 못함", () => {
    expect(atLeast("member", "admin")).toBe(false);
    expect(atLeast("admin", "owner")).toBe(false);
  });

  it("비멤버(null)는 어떤 요구도 충족하지 못함", () => {
    expect(atLeast(null, "member")).toBe(false);
  });
});

describe("isManager", () => {
  it("owner/admin 만 관리자", () => {
    expect(isManager("owner")).toBe(true);
    expect(isManager("admin")).toBe(true);
    expect(isManager("member")).toBe(false);
    expect(isManager(null)).toBe(false);
  });
});

describe("isMemberRole / isMemberScope", () => {
  it("유효한 역할만 통과", () => {
    expect(isMemberRole("owner")).toBe(true);
    expect(isMemberRole("viewer")).toBe(false); // 스키마에 없는 역할
    expect(isMemberRole(null)).toBe(false);
  });

  it("유효한 범위만 통과", () => {
    expect(isMemberScope("all")).toBe(true);
    expect(isMemberScope("assigned")).toBe(true);
    expect(isMemberScope("some")).toBe(false);
  });
});

/*
 * ★ 이름표가 «한 곳» 에서만 나오는지 지킨다.
 *
 * 착수 시점에 일곱 파일이 각자 역할 이름표를 적어 뒀고, 같은 역할이 네 이름으로 불렸다 —
 *   member → 멤버 · 사원 · 담당 · 구성원
 *   owner  → 소유자 · 대표
 * 그래서 한 사람이 목록 갈래에서는 「구성원」, 자리 갈래에서는 「담당」,
 * 권한표에서는 「멤버」로 보였다. 같은 화면 안에서도 갈래마다 달랐다.
 *
 * ★★ 그리고 그건 «불일치» 로 끝나지 않았다 — 개인정보 화면이 admin 을 「팀장」이라 불렀고,
 *    team_lead 는 아예 빠져서 팀장인 사람이 자기 역할을 「확인할 수 없어요」로 봤다.
 *    **손으로 적은 지도는 어긋나기만 하는 게 아니라 틀린다.**
 *
 * 이 시험이 없으면 다음 사람이 또 자기 파일에 적는다. 그때 여기서 걸린다.
 */
describe("역할·범위 이름표는 여기 하나가 정본이다", () => {
  it("★ 모든 역할에 이름이 있다 — 하나라도 빠지면 그 사람은 자기 역할을 못 본다", () => {
    for (const role of MEMBER_ROLES) {
      expect(roleLabel(role), `${role} 에 이름표가 없다`).toBeTruthy();
    }
  });

  it("★ 모든 범위에 이름이 있다", () => {
    for (const scope of MEMBER_SCOPES) {
      expect(scopeLabel(scope), `${scope} 에 이름표가 없다`).toBeTruthy();
    }
  });

  it("★ 이름이 서로 겹치지 않는다 — 두 역할이 같은 말로 보이면 구별이 안 된다", () => {
    const names = MEMBER_ROLES.map(roleLabel);
    expect(new Set(names).size).toBe(names.length);
  });

  it("모르는 값은 «모름» 이다 — 빈칸으로 두면 「없음」으로 읽힌다", () => {
    expect(roleLabelOrUnknown(null)).toBe("모름");
    expect(roleLabelOrUnknown(undefined)).toBe("모름");
    expect(roleLabelOrUnknown("member")).toBe(roleLabel("member"));
  });

  it("★ 「담당」을 역할 이름으로 쓰지 않는다 — 담당자·담당 보드로 이미 쓰는 말이다", () => {
    expect(MEMBER_ROLES.map(roleLabel)).not.toContain("담당");
  });
});
