import { describe, it, expect } from "vitest";
import {
  atLeast,
  isManager,
  isMemberRole,
  isMemberScope,
  roleRank,
  MEMBER_ROLES,
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
