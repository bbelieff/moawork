import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  hasSupabaseEnv: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/supabase/env", () => ({
  hasSupabaseEnv: mocks.hasSupabaseEnv,
}));

vi.mock("@/lib/auth/session", () => ({
  SESSION_COOKIE: { uid: "mw_uid", org: "mw_org", as: "mw_as" },
}));

import { POST } from "./route";

describe("POST /auth/signout", () => {
  beforeEach(() => {
    mocks.createClient.mockReset();
    mocks.hasSupabaseEnv.mockReset();
  });

  it("Supabase 현재 세션만 local scope로 로그아웃한다", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    mocks.hasSupabaseEnv.mockReturnValue(true);
    mocks.createClient.mockResolvedValue({ auth: { signOut } });

    const response = await POST(
      new Request("https://www.moa-work.com/auth/signout", { method: "POST" }),
    );

    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/login?reason=signed-out",
    );
    expect(response.headers.get("set-cookie")).toContain("mw_uid=");
  });

  it("로그아웃 실패를 성공처럼 표시하거나 쿠키 삭제하지 않는다", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: new Error("failed") });
    mocks.hasSupabaseEnv.mockReturnValue(true);
    mocks.createClient.mockResolvedValue({ auth: { signOut } });

    const response = await POST(
      new Request("https://www.moa-work.com/auth/signout", {
        method: "POST",
        headers: { referer: "https://www.moa-work.com/candidate-account" },
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/candidate-account?error=signout",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("로그아웃 호출이 예외를 던져도 쿠키를 삭제하지 않고 오류로 돌아간다", async () => {
    const signOut = vi.fn().mockRejectedValue(new Error("failed"));
    mocks.hasSupabaseEnv.mockReturnValue(true);
    mocks.createClient.mockResolvedValue({ auth: { signOut } });

    const response = await POST(
      new Request("https://www.moa-work.com/auth/signout", {
        method: "POST",
        headers: { referer: "https://www.moa-work.com/settings/account" },
      }),
    );

    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/settings/account?error=signout",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("개발 세션 쿠키를 지우고 signed-out 이유와 함께 이동한다", async () => {
    mocks.hasSupabaseEnv.mockReturnValue(false);

    const response = await POST(
      new Request("http://localhost:3000/auth/signout", { method: "POST" }),
    );

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "/login?reason=signed-out",
    );
    expect(response.headers.get("set-cookie")).toContain("mw_org=");
  });

  it("never uses an internal or forwarded host for the success Location", async () => {
    mocks.hasSupabaseEnv.mockReturnValue(false);
    const response = await POST(new Request("http://localhost:3100/auth/signout", {
      method: "POST", headers: { host: "www.moa-work.com", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
    }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?reason=signed-out");
    expect(response.headers.get("set-cookie")).toContain("mw_org=");
  });

  it("keeps foreign, malformed and unsafe error referers on the local fallback", async () => {
    mocks.hasSupabaseEnv.mockReturnValue(true);
    mocks.createClient.mockResolvedValue({ auth: { signOut: vi.fn().mockResolvedValue({ error: new Error("failed") }) } });
    for (const referer of ["https://evil.example/path", "http://[invalid", "https://www.moa-work.com//evil.example"]) {
      const response = await POST(new Request("https://www.moa-work.com/auth/signout", {
        method: "POST", headers: { referer },
      }));
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/?error=signout");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });
});
