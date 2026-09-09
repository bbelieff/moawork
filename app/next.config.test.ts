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

describe("managed Vercel build identity", () => {
  it("compiles the validated Vercel Git SHA over an untrusted public override", async () => {
    const config = await loadConfig({
      VERCEL: "1",
      VERCEL_GIT_COMMIT_SHA: VERCEL_SHA,
      NEXT_PUBLIC_APP_VERSION: OTHER_SHA,
    });

    expect(config.env?.NEXT_PUBLIC_APP_VERSION).toBe(VERCEL_SHA);

    process.env.VERCEL_GIT_COMMIT_SHA = OTHER_SHA;
    process.env.NEXT_PUBLIC_APP_VERSION = OTHER_SHA;
    expect(config.env?.NEXT_PUBLIC_APP_VERSION).toBe(VERCEL_SHA);
  });

  it("fails closed when managed Vercel omits the exact Git SHA", async () => {
    await expect(loadConfig({ VERCEL: "1" })).rejects.toThrow(
      "Managed Vercel builds require VERCEL_GIT_COMMIT_SHA as a full 40-character Git SHA.",
    );
  });

  it("fails closed when managed Vercel supplies a malformed Git SHA", async () => {
    await expect(
      loadConfig({ VERCEL: "1", VERCEL_GIT_COMMIT_SHA: "not-a-sha" }),
    ).rejects.toThrow("Build revision must be a full 40-character Git SHA.");
  });

  it.each([
    ["a conflicting self-hosted SHA", VERCEL_SHA],
    ["a missing Vercel SHA", undefined],
    ["a malformed Vercel SHA", "not-a-sha"],
  ])(
    "rejects %s even when MOAWORK_BUILD_SHA is otherwise valid",
    async (_label, vercelGitSha) => {
      await expect(
        loadConfig({
          VERCEL: "1",
          MOAWORK_BUILD_SHA: OTHER_SHA,
          NEXT_PUBLIC_APP_VERSION: OTHER_SHA,
          NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString(
            "base64",
          ),
          ...(vercelGitSha
            ? { VERCEL_GIT_COMMIT_SHA: vercelGitSha }
            : {}),
        }),
      ).rejects.toThrow(
        "Managed Vercel builds must not define the self-hosted MOAWORK_BUILD_SHA.",
      );
    },
  );

  it("does not replace the self-hosted GitHub SHA path outside Vercel", async () => {
    const config = await loadConfig({
      MOAWORK_BUILD_SHA: OTHER_SHA,
      NEXT_PUBLIC_APP_VERSION: OTHER_SHA,
      NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    });

    expect(config.env?.NEXT_PUBLIC_APP_VERSION).toBeUndefined();
    expect(config.env?.MOAWORK_SERVER_ACTIONS_BUILD_FINGERPRINT).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});
