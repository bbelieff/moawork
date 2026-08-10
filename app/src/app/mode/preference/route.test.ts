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
  return new Request("https://www.moa-work.com/mode/preference", {
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
      "https://www.moa-work.com/mode?next=%2Faccount%3Ftab%3Dprivacy",
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
});
