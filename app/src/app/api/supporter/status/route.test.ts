import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signModePreference } from "@/lib/mode/preference";
import type { Ctx } from "@/lib/types";

const SECRET = "a-supporter-status-test-secret-with-safe-length";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getSessionOrNull: vi.fn(),
  loadPlatformActor: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/auth/session", () => ({
  getSessionOrNull: mocks.getSessionOrNull,
}));
vi.mock("@/lib/platform/actor", () => ({
  loadPlatformActor: mocks.loadPlatformActor,
}));

import { GET } from "./route";

function session(role: Ctx["role"] = "member"): Ctx {
  return {
    user: {
      id: "user-1",
      email: null,
      name: "테스터",
      avatar_url: null,
      created_at: "2026-09-01T00:00:00Z",
    },
    org: {
      id: "org-1",
      name: "테스트 회사",
      plan_tier: "free",
      created_at: "2026-09-01T00:00:00Z",
    },
    role,
    scope: "all",
  };
}

function request(mode: string | null, cookie?: string): Request {
  const url =
    mode === null
      ? "http://localhost:3100/api/supporter/status"
      : `http://localhost:3100/api/supporter/status?mode=${mode}`;
  const headers = new Headers();
  if (cookie) headers.set("cookie", `mw_mode=${cookie}`);
  return new Request(url, { headers });
}

function cookieJar(value: string | undefined) {
  mocks.cookies.mockResolvedValue({
    get: (name: string) =>
      name === "mw_mode" && value ? { value } : undefined,
  });
}

describe("GET /api/supporter/status", () => {
  const previousSecret = process.env.MOAWORK_MODE_PREFERENCE_SECRET;

  beforeEach(() => {
    process.env.MOAWORK_MODE_PREFERENCE_SECRET = SECRET;
    mocks.cookies.mockReset();
    mocks.getSessionOrNull.mockReset();
    mocks.loadPlatformActor.mockReset();
    cookieJar(undefined);
  });

  afterEach(() => {
    if (previousSecret === undefined) {
      delete process.env.MOAWORK_MODE_PREFERENCE_SECRET;
    } else {
      process.env.MOAWORK_MODE_PREFERENCE_SECRET = previousSecret;
    }
  });

  it("rejects a missing, duplicated, or unknown mode strictly", async () => {
    for (const url of [
      "http://localhost:3100/api/supporter/status",
      "http://localhost:3100/api/supporter/status?mode=bogus",
      "http://localhost:3100/api/supporter/status?mode=user&mode=user",
      "http://localhost:3100/api/supporter/status?mode=",
    ]) {
      const response = await GET(new Request(url));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "mode_invalid" });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
  });

  it("returns 401 without an active company session", async () => {
    mocks.getSessionOrNull.mockResolvedValue(null);

    const response = await GET(request("user"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthenticated" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns metadata-only unavailable status for a company user", async () => {
    mocks.getSessionOrNull.mockResolvedValue(session());

    const response = await GET(request("user"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: { kind: "unavailable", reason: "not_configured" },
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects an owner-only company user from operations with 403", async () => {
    mocks.loadPlatformActor.mockResolvedValue({
      kind: "denied",
      reason: "not_platform",
    });
    cookieJar(signModePreference("platform") ?? undefined);

    const response = await GET(
      request("operations", signModePreference("platform") ?? undefined),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "operations_forbidden",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    // 운영 판정은 회사 세션을 조회하지 않는다.
    expect(mocks.getSessionOrNull).not.toHaveBeenCalled();
  });

  it("rejects operations when the signed display mode disagrees", async () => {
    mocks.loadPlatformActor.mockResolvedValue({ kind: "granted" });
    const userCookie = signModePreference("user") ?? undefined;
    cookieJar(userCookie);

    const response = await GET(request("operations", userCookie));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "operations_forbidden",
    });
    expect(mocks.getSessionOrNull).not.toHaveBeenCalled();
  });

  it("returns 401 for operations when the platform actor is unauthenticated", async () => {
    mocks.loadPlatformActor.mockResolvedValue({
      kind: "denied",
      reason: "unauthenticated",
    });
    cookieJar(undefined);

    const response = await GET(request("operations"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "unauthenticated",
    });
    expect(mocks.getSessionOrNull).not.toHaveBeenCalled();
  });

  it("allows operations with grant plus platform display and stays metadata-only", async () => {
    // 회사 세션이 없어도(모킹조차 안 해도) 플랫폼 승인으로 통과한다.
    mocks.loadPlatformActor.mockResolvedValue({ kind: "granted" });
    const platformCookie = signModePreference("platform") ?? undefined;
    cookieJar(platformCookie);

    const response = await GET(request("operations", platformCookie));

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.status).toEqual({ kind: "unavailable", reason: "not_configured" });
    expect(JSON.stringify(body)).not.toContain("org-1");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.getSessionOrNull).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the platform guard is unavailable", async () => {
    mocks.loadPlatformActor.mockResolvedValue({ kind: "unavailable" });
    cookieJar(signModePreference("platform") ?? undefined);

    const response = await GET(
      request("operations", signModePreference("platform") ?? undefined),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "status_unavailable",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.getSessionOrNull).not.toHaveBeenCalled();
  });

  it("returns 503, not a fabricated 401, when the production backend is unconfigured", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    try {
      const response = await GET(request("user"));

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: "status_unavailable",
      });
      expect(mocks.getSessionOrNull).not.toHaveBeenCalled();
    } finally {
      vi.stubEnv("NODE_ENV", previousNodeEnv);
      if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
      if (previousAnonKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
    }
  });

  it("fails closed with 503 when the auth backend throws", async () => {
    mocks.getSessionOrNull.mockRejectedValue(new Error("backend down"));

    const response = await GET(request("user"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "status_unavailable",
    });
  });
});
