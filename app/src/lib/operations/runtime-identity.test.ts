import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getLiveness } from "@/app/api/health/live/route";
import { GET as getReadiness } from "@/app/api/health/ready/route";
import {
  createHealthResponse,
  isAnalyticsBuildConfigEnabled,
  isPublicBuildConfigValid,
  isServerActionsEncryptionKeyValid,
  resolveArtifactSha256,
  resolveNextDeploymentId,
  resolveRuntimeIdentity,
  serverActionsKeyFingerprint,
  type PublicBuildConfig,
} from "./runtime-identity";
import readyFixture from "./runtime-identity.ready.fixture.json";

const BUILD_SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const ARTIFACT_SHA = "c".repeat(64);
const OTHER_ARTIFACT_SHA = "d".repeat(64);
const SERVER_ACTIONS_KEY = `${"A".repeat(43)}=`;
const SERVER_ACTIONS_FINGERPRINT = serverActionsKeyFingerprint(SERVER_ACTIONS_KEY)!;
const PUBLIC_CONFIG: PublicBuildConfig = {
  supabaseUrl: "https://srtvmpcosekduvsscsyz.supabase.co",
  supabaseAnonKey: `sb_publishable_${"a".repeat(24)}`,
  posthogKey: `phc_${"b".repeat(24)}`,
  appVersion: BUILD_SHA,
};

function stubPublicBuildConfig(): void {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", PUBLIC_CONFIG.supabaseUrl!);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", PUBLIC_CONFIG.supabaseAnonKey!);
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", PUBLIC_CONFIG.posthogKey!);
  vi.stubEnv("NEXT_PUBLIC_APP_VERSION", PUBLIC_CONFIG.appVersion!);
}

describe("runtime release identity", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("verifies one exact immutable build and release revision", () => {
    expect(
      resolveRuntimeIdentity({
        MOAWORK_BUILD_SHA: BUILD_SHA.toUpperCase(),
        MOAWORK_RELEASE_SHA: BUILD_SHA,
      }),
    ).toEqual({
      service: "moawork-web",
      runtime: "self-hosted",
      buildSha: BUILD_SHA,
      releaseSha: BUILD_SHA,
      revisionVerified: true,
    });
  });

  it("requires an independent release expectation for a container", () => {
    expect(resolveRuntimeIdentity({ MOAWORK_BUILD_SHA: BUILD_SHA })).toMatchObject(
      { releaseSha: null, revisionVerified: false },
    );
  });

  it("uses a managed commit as the expectation only on Vercel", () => {
    expect(
      resolveRuntimeIdentity({
        VERCEL: "1",
        VERCEL_GIT_COMMIT_SHA: BUILD_SHA,
      }),
    ).toMatchObject({
      buildSha: BUILD_SHA,
      releaseSha: BUILD_SHA,
      revisionVerified: true,
    });
    expect(
      resolveRuntimeIdentity({ VERCEL_GIT_COMMIT_SHA: BUILD_SHA })
        .revisionVerified,
    ).toBe(false);
  });

  it("keeps Vercel's opaque deployment identity separate from the source SHA", () => {
    expect(
      resolveNextDeploymentId({
        VERCEL: "1",
        VERCEL_GIT_COMMIT_SHA: BUILD_SHA,
        VERCEL_DEPLOYMENT_ID: "dpl_platform-opaque",
        NEXT_DEPLOYMENT_ID: "dpl_platform-opaque",
      }),
    ).toBeUndefined();

    expect(
      resolveNextDeploymentId({
        MOAWORK_BUILD_SHA: BUILD_SHA,
        MOAWORK_RELEASE_SHA: BUILD_SHA,
      }),
    ).toBe(BUILD_SHA);
    expect(resolveNextDeploymentId({})).toBeUndefined();
    expect(
      resolveNextDeploymentId({ MOAWORK_BUILD_SHA: "not-a-git-sha" }),
    ).toBeUndefined();
  });

  it("fails readiness for missing, malformed, or mismatched revisions", () => {
    expect(resolveRuntimeIdentity({}).revisionVerified).toBe(false);
    expect(
      resolveRuntimeIdentity({ MOAWORK_BUILD_SHA: "main" }).revisionVerified,
    ).toBe(false);
    expect(
      resolveRuntimeIdentity({
        MOAWORK_BUILD_SHA: BUILD_SHA,
        MOAWORK_RELEASE_SHA: OTHER_SHA,
      }).revisionVerified,
    ).toBe(false);
  });

  it("exposes only the injected self-hosted artifact identity and explicit managed boundaries", () => {
    expect(
      resolveArtifactSha256(
        { MOAWORK_ARTIFACT_SHA256: ARTIFACT_SHA },
        "self-hosted",
      ),
    ).toBe(ARTIFACT_SHA);
    expect(
      resolveArtifactSha256(
        { MOAWORK_ARTIFACT_SHA256: ARTIFACT_SHA.toUpperCase() },
        "self-hosted",
      ),
    ).toBe("unknown");
    expect(resolveArtifactSha256({}, "self-hosted")).toBe("unknown");
    expect(
      resolveArtifactSha256(
        { MOAWORK_ARTIFACT_SHA256: ARTIFACT_SHA },
        "vercel",
      ),
    ).toBe("managed");
    expect(
      resolveArtifactSha256(
        { MOAWORK_ARTIFACT_SHA256: ARTIFACT_SHA },
        "unknown",
      ),
    ).toBe("unknown");
  });

  it("requires the public configuration embedded in the artifact", () => {
    expect(isPublicBuildConfigValid(PUBLIC_CONFIG, BUILD_SHA)).toBe(true);

    for (const field of [
      "supabaseUrl",
      "supabaseAnonKey",
      "appVersion",
    ] as const) {
      expect(
        isPublicBuildConfigValid(
          { ...PUBLIC_CONFIG, [field]: undefined },
          BUILD_SHA,
        ),
        field,
      ).toBe(false);
    }

    expect(
      isPublicBuildConfigValid(
        { ...PUBLIC_CONFIG, supabaseUrl: "http://project.supabase.example" },
        BUILD_SHA,
      ),
    ).toBe(false);
    expect(
      isPublicBuildConfigValid(
        { ...PUBLIC_CONFIG, appVersion: OTHER_SHA },
        BUILD_SHA,
      ),
    ).toBe(false);

    for (const supabaseUrl of [
      "https://user:pass@srtvmpcosekduvsscsyz.supabase.co",
      "https://another-project.supabase.co",
      "https://srtvmpcosekduvsscsyz.supabase.co/rest",
      "https://srtvmpcosekduvsscsyz.supabase.co/?tenant=other",
      "https://srtvmpcosekduvsscsyz.supabase.co/#fragment",
    ]) {
      expect(
        isPublicBuildConfigValid({ ...PUBLIC_CONFIG, supabaseUrl }, BUILD_SHA),
        supabaseUrl,
      ).toBe(false);
    }
    expect(
      isPublicBuildConfigValid(
        { ...PUBLIC_CONFIG, supabaseAnonKey: "x" },
        BUILD_SHA,
      ),
    ).toBe(false);
    expect(
      isPublicBuildConfigValid(
        {
          ...PUBLIC_CONFIG,
          supabaseAnonKey: `eyJ${"a".repeat(24)}.${"b".repeat(24)}.${"c".repeat(24)}`,
        },
        BUILD_SHA,
      ),
    ).toBe(true);
  });

  it("separates public-config validity from the required analytics readiness signal", () => {
    expect(isAnalyticsBuildConfigEnabled(PUBLIC_CONFIG)).toBe(true);
    expect(isAnalyticsBuildConfigEnabled({ ...PUBLIC_CONFIG, posthogKey: undefined })).toBe(false);
    expect(isAnalyticsBuildConfigEnabled({ ...PUBLIC_CONFIG, posthogKey: "phc_x" })).toBe(false);
    expect(isPublicBuildConfigValid({ ...PUBLIC_CONFIG, posthogKey: undefined }, BUILD_SHA)).toBe(true);
  });

  it("does not report ready when the release has no valid PostHog public key", async () => {
    const response = createHealthResponse(
      "ready",
      {
        MOAWORK_BUILD_SHA: BUILD_SHA,
        MOAWORK_RELEASE_SHA: BUILD_SHA,
        MOAWORK_ARTIFACT_SHA256: ARTIFACT_SHA,
        NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: SERVER_ACTIONS_KEY,
        MOAWORK_SERVER_ACTIONS_BUILD_FINGERPRINT: SERVER_ACTIONS_FINGERPRINT,
      },
      { ...PUBLIC_CONFIG, posthogKey: undefined },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "not_ready",
      configuration: "verified",
      analytics: "disabled",
    });
  });

  it("accepts only canonical base64 AES key lengths without exposing a value", () => {
    for (const bytes of [16, 24, 32]) {
      const canonical = Buffer.alloc(bytes).toString("base64");
      expect(isServerActionsEncryptionKeyValid(canonical), String(bytes)).toBe(true);
    }
    for (const malformed of [
      undefined,
      "",
      "not-base64",
      Buffer.alloc(15).toString("base64"),
      Buffer.alloc(17).toString("base64"),
      `${SERVER_ACTIONS_KEY}\n`,
      SERVER_ACTIONS_KEY.replace(/=$/, ""),
    ]) {
      expect(isServerActionsEncryptionKeyValid(malformed)).toBe(false);
    }
  });

  it("never reflects malformed values or unrelated secrets", async () => {
    const response = createHealthResponse(
      "ready",
      {
        MOAWORK_BUILD_SHA: "secret-token-must-not-leak",
        MOAWORK_RELEASE_SHA: BUILD_SHA,
        NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: SERVER_ACTIONS_KEY,
        DATABASE_URL: "postgres://private.example.invalid/tenant",
      },
      {
        ...PUBLIC_CONFIG,
        supabaseAnonKey: "another-secret-must-not-leak",
      },
    );
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("another-secret");
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("DATABASE_URL");
    expect(serialized).not.toContain(SERVER_ACTIONS_KEY);
  });

  it("serves liveness independently and gates readiness on exact release state", async () => {
    stubPublicBuildConfig();
    vi.stubEnv("MOAWORK_BUILD_SHA", BUILD_SHA);
    vi.stubEnv("MOAWORK_RELEASE_SHA", OTHER_SHA);
    vi.stubEnv("MOAWORK_ARTIFACT_SHA256", ARTIFACT_SHA);
    vi.stubEnv("NEXT_SERVER_ACTIONS_ENCRYPTION_KEY", SERVER_ACTIONS_KEY);
    vi.stubEnv("MOAWORK_SERVER_ACTIONS_BUILD_FINGERPRINT", SERVER_ACTIONS_FINGERPRINT);

    const live = getLiveness();
    const ready = getReadiness();

    expect(live.status).toBe(200);
    expect(ready.status).toBe(503);
    await expect(live.json()).resolves.toMatchObject({ status: "alive" });
    await expect(ready.json()).resolves.toEqual({
      service: "moawork-web",
      status: "not_ready",
      runtime: "self-hosted",
      revision: "unverified",
      configuration: "verified",
      configurationFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      artifact: "verified",
      artifactSha256: ARTIFACT_SHA,
      analytics: "configured",
      serverActions: "verified",
      serverActionsKeyFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      buildSha: BUILD_SHA,
      releaseSha: OTHER_SHA,
    });
    expect(ready.headers.get("cache-control")).toBe("no-store, max-age=0");
  });

  it("returns ready only when revision and embedded public config both pass", async () => {
    const response = createHealthResponse(
      "ready",
      {
        MOAWORK_BUILD_SHA: BUILD_SHA,
        MOAWORK_RELEASE_SHA: BUILD_SHA,
        MOAWORK_ARTIFACT_SHA256: ARTIFACT_SHA,
        NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: SERVER_ACTIONS_KEY,
        MOAWORK_SERVER_ACTIONS_BUILD_FINGERPRINT: SERVER_ACTIONS_FINGERPRINT,
      },
      PUBLIC_CONFIG,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ready",
      revision: "verified",
      configuration: "verified",
      artifact: "verified",
      artifactSha256: ARTIFACT_SHA,
      analytics: "configured",
      serverActions: "verified",
      runtime: "self-hosted",
    });
  });

  it("serves the injected artifact identity from the actual readiness route", async () => {
    stubPublicBuildConfig();
    vi.stubEnv("MOAWORK_BUILD_SHA", BUILD_SHA);
    vi.stubEnv("MOAWORK_RELEASE_SHA", BUILD_SHA);
    vi.stubEnv("MOAWORK_ARTIFACT_SHA256", ARTIFACT_SHA);
    vi.stubEnv("NEXT_SERVER_ACTIONS_ENCRYPTION_KEY", SERVER_ACTIONS_KEY);
    vi.stubEnv("MOAWORK_SERVER_ACTIONS_BUILD_FINGERPRINT", SERVER_ACTIONS_FINGERPRINT);

    const ready = getReadiness();
    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toMatchObject({
      status: "ready",
      artifact: "verified",
      artifactSha256: ARTIFACT_SHA,
    });

    for (const malformed of ["", ARTIFACT_SHA.toUpperCase()]) {
      vi.stubEnv("MOAWORK_ARTIFACT_SHA256", malformed);
      const unavailable = getReadiness();
      expect(unavailable.status, malformed).toBe(503);
      await expect(unavailable.json()).resolves.toMatchObject({
        status: "not_ready",
        artifact: "unverified",
        artifactSha256: "unknown",
      });
    }
  });

  it("reports an explicit Vercel stable key as verified, not managed", async () => {
    const response = createHealthResponse(
      "ready",
      {
        VERCEL: "1",
        VERCEL_GIT_COMMIT_SHA: BUILD_SHA,
        NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: SERVER_ACTIONS_KEY,
        MOAWORK_SERVER_ACTIONS_BUILD_FINGERPRINT: SERVER_ACTIONS_FINGERPRINT,
      },
      PUBLIC_CONFIG,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      runtime: "vercel",
      artifact: "managed",
      artifactSha256: "managed",
      serverActions: "verified",
      serverActionsKeyFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("fails closed when the runtime key differs from the key consumed by the build", async () => {
    const response = createHealthResponse(
      "ready",
      {
        MOAWORK_BUILD_SHA: BUILD_SHA,
        MOAWORK_RELEASE_SHA: BUILD_SHA,
        MOAWORK_ARTIFACT_SHA256: ARTIFACT_SHA,
        NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: SERVER_ACTIONS_KEY,
        MOAWORK_SERVER_ACTIONS_BUILD_FINGERPRINT: OTHER_ARTIFACT_SHA,
      },
      PUBLIC_CONFIG,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "not_ready",
      serverActions: "unverified",
      serverActionsKeyFingerprint: "unavailable",
    });
  });

  it("keeps managed Vercel ready before handoff but requires a key when self-hosted", async () => {
    const vercel = createHealthResponse(
      "ready",
      { VERCEL: "1", VERCEL_GIT_COMMIT_SHA: BUILD_SHA },
      PUBLIC_CONFIG,
    );
    expect(vercel.status).toBe(200);
    await expect(vercel.json()).resolves.toMatchObject({
      runtime: "vercel",
      artifact: "managed",
      artifactSha256: "managed",
      serverActions: "managed",
      serverActionsKeyFingerprint: "managed",
    });

    const selfHosted = createHealthResponse(
      "ready",
      {
        MOAWORK_BUILD_SHA: BUILD_SHA,
        MOAWORK_RELEASE_SHA: BUILD_SHA,
        MOAWORK_ARTIFACT_SHA256: ARTIFACT_SHA,
      },
      PUBLIC_CONFIG,
    );
    expect(selfHosted.status).toBe(503);
    await expect(selfHosted.json()).resolves.toMatchObject({
      runtime: "self-hosted",
      artifact: "verified",
      artifactSha256: ARTIFACT_SHA,
      serverActions: "unverified",
    });
  });

  it("requires an exact immutable artifact digest for self-hosted readiness", async () => {
    const baseEnvironment = {
      MOAWORK_BUILD_SHA: BUILD_SHA,
      MOAWORK_RELEASE_SHA: BUILD_SHA,
      NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: SERVER_ACTIONS_KEY,
      MOAWORK_SERVER_ACTIONS_BUILD_FINGERPRINT: SERVER_ACTIONS_FINGERPRINT,
    };

    for (const artifactSha of [undefined, "C".repeat(64), "c".repeat(63)]) {
      const response = createHealthResponse(
        "ready",
        { ...baseEnvironment, MOAWORK_ARTIFACT_SHA256: artifactSha },
        PUBLIC_CONFIG,
      );
      expect(response.status, artifactSha).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        artifact: "unverified",
        artifactSha256: "unknown",
      });
    }
  });

  it("publishes a different canonical digest without claiming archive equality", async () => {
    const response = createHealthResponse(
      "ready",
      {
        MOAWORK_BUILD_SHA: BUILD_SHA,
        MOAWORK_RELEASE_SHA: BUILD_SHA,
        MOAWORK_ARTIFACT_SHA256: OTHER_ARTIFACT_SHA,
        NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: SERVER_ACTIONS_KEY,
        MOAWORK_SERVER_ACTIONS_BUILD_FINGERPRINT: SERVER_ACTIONS_FINGERPRINT,
      },
      PUBLIC_CONFIG,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ready",
      artifact: "verified",
      artifactSha256: OTHER_ARTIFACT_SHA,
    });
  });

  it("returns opaque full fingerprints and changes them on stable-key rotation", async () => {
    const first = await createHealthResponse(
      "ready",
      {
        VERCEL: "1",
        VERCEL_GIT_COMMIT_SHA: BUILD_SHA,
        NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: SERVER_ACTIONS_KEY,
        MOAWORK_SERVER_ACTIONS_BUILD_FINGERPRINT: SERVER_ACTIONS_FINGERPRINT,
      },
      PUBLIC_CONFIG,
    ).json() as { serverActionsKeyFingerprint: string };
    const secondKey = Buffer.alloc(32, 9).toString("base64");
    const second = await createHealthResponse(
      "ready",
      {
        VERCEL: "1",
        VERCEL_GIT_COMMIT_SHA: BUILD_SHA,
        NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: secondKey,
        MOAWORK_SERVER_ACTIONS_BUILD_FINGERPRINT:
          serverActionsKeyFingerprint(secondKey)!,
      },
      PUBLIC_CONFIG,
    ).json() as { serverActionsKeyFingerprint: string };

    expect(first.serverActionsKeyFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(second.serverActionsKeyFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(second.serverActionsKeyFingerprint).not.toBe(first.serverActionsKeyFingerprint);
    expect(JSON.stringify(first)).not.toContain(SERVER_ACTIONS_KEY);
    expect(JSON.stringify(second)).not.toContain(secondKey);
  });

  it("matches the producer fixtures consumed by the deployment health gate", async () => {
    const selfHosted = await createHealthResponse(
      "ready",
      {
        MOAWORK_BUILD_SHA: BUILD_SHA,
        MOAWORK_RELEASE_SHA: BUILD_SHA,
        MOAWORK_ARTIFACT_SHA256: ARTIFACT_SHA,
        NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: SERVER_ACTIONS_KEY,
        MOAWORK_SERVER_ACTIONS_BUILD_FINGERPRINT: SERVER_ACTIONS_FINGERPRINT,
      },
      PUBLIC_CONFIG,
    ).json();
    const vercelStable = await createHealthResponse(
      "ready",
      {
        VERCEL: "1",
        VERCEL_GIT_COMMIT_SHA: BUILD_SHA,
        NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: SERVER_ACTIONS_KEY,
        MOAWORK_SERVER_ACTIONS_BUILD_FINGERPRINT: SERVER_ACTIONS_FINGERPRINT,
      },
      PUBLIC_CONFIG,
    ).json();
    const vercelManaged = await createHealthResponse(
      "ready",
      { VERCEL: "1", VERCEL_GIT_COMMIT_SHA: BUILD_SHA },
      PUBLIC_CONFIG,
    ).json();
    const vercelManagedNoAnalytics = await createHealthResponse(
      "ready",
      { VERCEL: "1", VERCEL_GIT_COMMIT_SHA: BUILD_SHA },
      { ...PUBLIC_CONFIG, posthogKey: undefined },
    ).json();

    expect(selfHosted).toEqual(readyFixture.selfHosted);
    expect(vercelStable).toEqual(readyFixture.vercelStable);
    expect(vercelManaged).toEqual(readyFixture.vercelManaged);
    expect(vercelManagedNoAnalytics).toEqual(
      readyFixture.vercelManagedNoAnalytics,
    );
  });
});
