import type { NextConfig } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "MOAWORK_BUILD_SHA",
  "NEXT_PUBLIC_APP_VERSION",
  "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
  "VERCEL",
  "VERCEL_GIT_COMMIT_SHA",
] as const;

const ORIGINAL_ENV = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

const VERCEL_SHA = "1234567890abcdef1234567890abcdef12345678";
const OTHER_SHA = "abcdef1234567890abcdef1234567890abcdef12";

async function loadConfig(
  env: Partial<Record<(typeof ENV_KEYS)[number], string>>,
): Promise<NextConfig> {
  vi.unstubAllEnvs();
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  vi.resetModules();
  return (await import("./next.config")).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINAL_ENV[key];
    }
  }
  vi.resetModules();
});

describe("self-hosted build identity", () => {
  // 매니지드 플랫폼 변수는 빌드 신원의 근거가 아니다. 그 변수가 빌드 환경에
  // 흘러들어온 것만으로 릴리스가 식별되면 안 된다.
  it("ignores managed-platform build variables entirely", async () => {
    const config = await loadConfig({
      VERCEL: "1",
      VERCEL_GIT_COMMIT_SHA: VERCEL_SHA,
      NEXT_PUBLIC_APP_VERSION: VERCEL_SHA,
    });

    expect(config.env?.NEXT_PUBLIC_APP_VERSION).toBeUndefined();
    expect(config.deploymentId).toBeUndefined();
  });

  it("fails closed on a malformed self-hosted Git SHA", async () => {
    await expect(
      loadConfig({ MOAWORK_BUILD_SHA: "not-a-sha" }),
    ).rejects.toThrow("Build revision must be a full 40-character Git SHA.");
  });

  it("uses the self-hosted GitHub SHA as the deployment identity", async () => {
    const config = await loadConfig({
      MOAWORK_BUILD_SHA: OTHER_SHA,
      NEXT_PUBLIC_APP_VERSION: OTHER_SHA,
      NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    });

    expect(config.deploymentId).toBe(OTHER_SHA);
    expect(config.env?.NEXT_PUBLIC_APP_VERSION).toBeUndefined();
    expect(config.env?.MOAWORK_SERVER_ACTIONS_BUILD_FINGERPRINT).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});
