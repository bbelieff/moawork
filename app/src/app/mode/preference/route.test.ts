import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadPlatformActor: vi.fn(),
}));

vi.mock("@/lib/platform/actor", () => ({
  loadPlatformActor: mocks.loadPlatformActor,
}));

import { POST } from "./route";

function formRequest(mode: string, next?: string): Request {
  const form = new FormData();
  form.set("mode", mode);
  if (next) form.set("next", next);
  return new Request("http://localhost:3100/mode/preference", {
    method: "POST",
    body: form,
  });
}

describe("POST /mode/preference", () => {
  const previousSecret = process.env.MOAWORK_MODE_PREFERENCE_SECRET;

  beforeEach(() => {
    process.env.MOAWORK_MODE_PREFERENCE_SECRET = "a-mode-preference-test-secret-with-safe-length";
    mocks.loadPlatformActor.mockReset();
  });

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.MOAWORK_MODE_PREFERENCE_SECRET;
    else process.env.MOAWORK_MODE_PREFERENCE_SECRET = previousSecret;
  });

  it("sets a signed HttpOnly preference only after the canonical platform guard", async () => {
    mocks.loadPlatformActor.mockResolvedValue({ kind: "granted" });

    const response = await POST(formRequest("platform", "/account?tab=privacy"));

    expect(response.headers.get("location")).toBe(
      "/mode?next=%2Faccount%3Ftab%3Dprivacy",
    );
    expect(response.headers.get("set-cookie")).toMatch(/mw_mode=v1\.platform\./);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
  });

  it("rejects ordinary mode mutation without setting a preference", async () => {
    mocks.loadPlatformActor.mockResolvedValue({ kind: "denied" });

    const response = await POST(formRequest("user"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "mode_forbidden" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("fails closed when the platform guard is unavailable", async () => {
    mocks.loadPlatformActor.mockResolvedValue({ kind: "unavailable" });

    const response = await POST(formRequest("platform"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "mode_unavailable" });
  });

  it("rejects a malformed mode value as a raw 400 — a real client bug, not a config problem", async () => {
    mocks.loadPlatformActor.mockResolvedValue({ kind: "granted" });

    const response = await POST(formRequest("not-a-real-mode"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "mode_invalid" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("sends an accepted choice to a human-readable page instead of a raw-JSON dead end when the secret is missing", async () => {
    delete process.env.MOAWORK_MODE_PREFERENCE_SECRET;
    mocks.loadPlatformActor.mockResolvedValue({ kind: "granted" });

    const response = await POST(formRequest("platform", "/account?tab=privacy"));

    // Not a 400 JSON body — a redirect to a page a person can read.
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get("location")).toBe(
      "/mode?next=%2Faccount%3Ftab%3Dprivacy&error=config",
    );
    // No preference is persisted — we could not produce a trustworthy signed cookie.
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("does not confuse a short/weak secret with a missing one", async () => {
    process.env.MOAWORK_MODE_PREFERENCE_SECRET = "too-short";
    mocks.loadPlatformActor.mockResolvedValue({ kind: "granted" });

    const response = await POST(formRequest("user"));

    expect(response.headers.get("location")).toContain("error=config");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
