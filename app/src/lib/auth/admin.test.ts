import { describe, expect, it } from "vitest";
import {
  adminGrantFromFallback,
  normalizeEmail,
  parseAdminRole,
  PLATFORM_ADMIN_FALLBACK,
  resolveAdminGrant,
} from "./admin";

describe("normalizeEmail", () => {
  it("소문자·트림으로 정규화한다(005 의 lower(p_email) 와 동일)", () => {
    expect(normalizeEmail("  BeliefKimKim@Gmail.com ")).toBe(
      "beliefkimkim@gmail.com",
    );
  });

  it("빈 값/비문자열은 null", () => {
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});

describe("adminGrantFromFallback", () => {
  it("예약된 belie 이메일은 owner + 플랫폼 관리자", () => {
    expect(adminGrantFromFallback("beliefkimkim@gmail.com")).toEqual({
      role: "owner",
      isPlatform: true,
    });
  });

  it("대소문자가 달라도 매칭된다", () => {
    expect(adminGrantFromFallback("BELIEFKIMKIM@GMAIL.COM")?.role).toBe("owner");
  });

  it("목록에 없는 사용자는 null", () => {
    expect(adminGrantFromFallback("someone@example.com")).toBeNull();
  });

  it("폴백 목록은 005_app_admins.sql 의 seed 와 동일해야 한다", () => {
    // 값이 갈리면 실DB 연결 전후로 판정이 달라진다 — 회귀 가드.
    expect(PLATFORM_ADMIN_FALLBACK).toEqual([
      { email: "beliefkimkim@gmail.com", role: "owner", is_platform: true },
    ]);
  });
});

describe("parseAdminRole", () => {
  it("유효한 역할만 통과시킨다", () => {
    expect(parseAdminRole("owner")).toBe("owner");
    expect(parseAdminRole("admin")).toBe("admin");
    expect(parseAdminRole("superuser")).toBeNull();
    expect(parseAdminRole(null)).toBeNull();
    expect(parseAdminRole(42)).toBeNull();
  });
});

describe("resolveAdminGrant", () => {
  it("RPC 가 역할을 주면 그것을 쓴다(실DB 우선)", async () => {
    const grant = await resolveAdminGrant("someone@example.com", async () => "admin");
    expect(grant).toEqual({ role: "admin", isPlatform: true });
  });

  it("RPC 에 정규화된 이메일을 넘긴다", async () => {
    let seen: string | null = null;
    await resolveAdminGrant("  Foo@Bar.COM ", async (e) => {
      seen = e;
      return null;
    });
    expect(seen).toBe("foo@bar.com");
  });

  it("RPC 가 null 이면 관리자가 아니다 — 폴백으로 뒤집지 않는다", async () => {
    // 실DB 가 '관리자 아님'을 명시했는데 폴백이 승격시키면 권한 상승 버그가 된다.
    const grant = await resolveAdminGrant(
      "beliefkimkim@gmail.com",
      async () => null,
    );
    expect(grant).toBeNull();
  });

  it("RPC 가 던지면 폴백으로 내려간다(로그인 자체는 막지 않음)", async () => {
    const grant = await resolveAdminGrant("beliefkimkim@gmail.com", async () => {
      throw new Error("network");
    });
    expect(grant).toEqual({ role: "owner", isPlatform: true });
  });

  it("RPC 가 없으면(미연결) 폴백을 쓴다", async () => {
    expect(await resolveAdminGrant("beliefkimkim@gmail.com")).toEqual({
      role: "owner",
      isPlatform: true,
    });
    expect(await resolveAdminGrant("nobody@example.com")).toBeNull();
  });

  it("이메일이 없으면 null", async () => {
    expect(await resolveAdminGrant(null)).toBeNull();
  });
});
