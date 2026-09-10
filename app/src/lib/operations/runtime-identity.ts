import { createHash, createHmac } from "node:crypto";

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const FULL_SHA256 = /^[0-9a-f]{64}$/;
const POSTHOG_PUBLIC_KEY = /^phc_[A-Za-z0-9_-]{20,}$/;
const PUBLISHABLE_SUPABASE_KEY = /^sb_publishable_[A-Za-z0-9_-]{20,}$/;
const JWT_SHAPE = /^eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}$/;
const EXPECTED_SUPABASE_ORIGIN = "https://srtvmpcosekduvsscsyz.supabase.co";
const ACTIONS_FINGERPRINT_CONTEXT = "moawork:server-actions:fingerprint:v1";

export const RUNTIME_SERVICE_NAME = "moawork-web";

export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;
export type RuntimeFlavor = "self-hosted" | "vercel" | "unknown";

export type RuntimeIdentity = Readonly<{
  service: typeof RUNTIME_SERVICE_NAME;
  runtime: RuntimeFlavor;
  buildSha: string | null;
  releaseSha: string | null;
  revisionVerified: boolean;
}>;

export type PublicBuildConfig = Readonly<{
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  posthogKey?: string;
  appVersion?: string;
}>;

export type HealthKind = "live" | "ready";

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function publicSha(value: string | null): string | null {
  return value && FULL_GIT_SHA.test(value) ? value.toLowerCase() : null;
}

function canonicalBase64Key(value: string | undefined): Buffer | null {
  if (!value || value !== value.trim() || /\s/.test(value)) return null;
  try {
    const decoded = Buffer.from(value, "base64");
    if (![16, 24, 32].includes(decoded.length)) return null;
    return decoded.toString("base64") === value ? decoded : null;
  } catch {
    return null;
  }
}

function safePublicToken(value: string | undefined): boolean {
  return Boolean(
    value && value === value.trim() && !/[\s\u0000-\u001f]/.test(value),
  );
}

function exactSupabaseOrigin(value: string | undefined): boolean {
  try {
    const url = new URL(value ?? "");
    return (
      url.origin === EXPECTED_SUPABASE_ORIGIN &&
      url.href === `${EXPECTED_SUPABASE_ORIGIN}/` &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

export function resolveBuildSha(environment: RuntimeEnvironment): string | null {
  return publicSha(
    nonEmpty(environment.MOAWORK_BUILD_SHA) ??
      nonEmpty(environment.VERCEL_GIT_COMMIT_SHA),
  );
}

/**
 * Vercel owns its deployment identifier and injects it separately from the
 * source revision. Supplying our Git SHA as next.config `deploymentId` would
 * override that opaque `dpl_*` identity and makes a managed build fail. The
 * self-hosted artifact still needs one stable skew identifier across slots.
 */
export function resolveNextDeploymentId(
  environment: RuntimeEnvironment,
): string | undefined {
  return environment.VERCEL === "1"
    ? undefined
    : (resolveBuildSha(environment) ?? undefined);
}

/**
 * Literal reads are intentional. Next replaces NEXT_PUBLIC_* at build time,
 * so readiness describes the exact public configuration in the release.
 */
export function readPublicBuildConfig(): PublicBuildConfig {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    posthogKey: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION,
  };
}

export function isAnalyticsBuildConfigEnabled(config: PublicBuildConfig): boolean {
  return POSTHOG_PUBLIC_KEY.test(config.posthogKey ?? "");
}

export function isServerActionsEncryptionKeyValid(value: string | undefined): boolean {
  return canonicalBase64Key(value) !== null;
}

export function serverActionsKeyFingerprint(value: string | undefined): string | null {
  const key = canonicalBase64Key(value);
  if (!key) return null;
  return createHmac("sha256", key)
    .update(ACTIONS_FINGERPRINT_CONTEXT)
    .digest("hex");
}

export function resolveServerActionsBuildFingerprint(
  environment: RuntimeEnvironment,
  compiledValue: string | undefined = environment === process.env
    // next.config `env` replaces this direct access at build time. Keep it
    // separate from the dynamic runtime key so a process-level key swap cannot
    // rewrite the fingerprint of the key that produced the bundle.
    ? process.env.MOAWORK_SERVER_ACTIONS_BUILD_FINGERPRINT
    : environment.MOAWORK_SERVER_ACTIONS_BUILD_FINGERPRINT,
): string | null {
  return compiledValue && FULL_SHA256.test(compiledValue)
    ? compiledValue
    : null;
}

export function publicBuildConfigFingerprint(
  config: PublicBuildConfig,
  buildSha: string | null,
): string | null {
  if (!isPublicBuildConfigValid(config, buildSha)) return null;
  return createHash("sha256")
    .update(
      JSON.stringify({
        supabaseUrl: config.supabaseUrl,
        supabaseAnonKey: config.supabaseAnonKey,
        posthogKey: config.posthogKey ?? null,
        appVersion: config.appVersion,
      }),
    )
    .digest("hex");
}

export function resolveArtifactStatus(
  environment: RuntimeEnvironment,
  runtime: RuntimeFlavor,
): "verified" | "managed" | "unverified" {
  if (runtime === "vercel") return "managed";
  return runtime === "self-hosted" &&
    FULL_SHA256.test(environment.MOAWORK_ARTIFACT_SHA256 ?? "")
    ? "verified"
    : "unverified";
}

/**
 * Public identity injected by the release executor. This proves only that the
 * process received a canonical digest; archive-to-runtime equality is checked
 * by the deployment verifier, not by the application itself.
 */
export function resolveArtifactSha256(
  environment: RuntimeEnvironment,
  runtime: RuntimeFlavor,
): string {
  if (runtime === "vercel") return "managed";
  const value = environment.MOAWORK_ARTIFACT_SHA256;
  return runtime === "self-hosted" && value && FULL_SHA256.test(value)
    ? value
    : "unknown";
}

export function isPublicBuildConfigValid(
  config: PublicBuildConfig,
  buildSha: string | null,
): boolean {
  const anonKey = config.supabaseAnonKey;
  return Boolean(
    buildSha &&
      exactSupabaseOrigin(config.supabaseUrl) &&
      safePublicToken(anonKey) &&
      (PUBLISHABLE_SUPABASE_KEY.test(anonKey ?? "") ||
        JWT_SHAPE.test(anonKey ?? "")) &&
      publicSha(nonEmpty(config.appVersion)) === buildSha,
  );
}

export function resolveRuntimeIdentity(
  environment: RuntimeEnvironment = process.env,
): RuntimeIdentity {
  const selfHostedBuild = nonEmpty(environment.MOAWORK_BUILD_SHA);
  const vercelBuild = nonEmpty(environment.VERCEL_GIT_COMMIT_SHA);
  const runtime: RuntimeFlavor = selfHostedBuild
    ? "self-hosted"
    : environment.VERCEL === "1"
      ? "vercel"
      : "unknown";
  const rawBuildSha = selfHostedBuild ?? vercelBuild;
  const rawReleaseSha =
    nonEmpty(environment.MOAWORK_RELEASE_SHA) ??
    (runtime === "vercel" ? vercelBuild : null);
  const buildSha = publicSha(rawBuildSha);
  const releaseSha = publicSha(rawReleaseSha);

  return {
    service: RUNTIME_SERVICE_NAME,
    runtime,
    buildSha,
    releaseSha,
    revisionVerified:
      buildSha !== null && releaseSha !== null && buildSha === releaseSha,
  };
}

/** Stable, non-cacheable health response with an allowlisted public shape. */
export function createHealthResponse(
  kind: HealthKind,
  environment: RuntimeEnvironment = process.env,
  publicConfig: PublicBuildConfig = readPublicBuildConfig(),
): Response {
  const identity = resolveRuntimeIdentity(environment);
  const configurationVerified = isPublicBuildConfigValid(
    publicConfig,
    identity.buildSha,
  );
  const analyticsConfigured = isAnalyticsBuildConfigEnabled(publicConfig);
  const actionsFingerprint = serverActionsKeyFingerprint(
    environment.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY,
  );
  const actionsBuildFingerprint = resolveServerActionsBuildFingerprint(environment);
  // A managed Vercel release may keep serving before handoff. Once an explicit
  // key exists it must be valid and exposes the comparable opaque fingerprint.
  const managedVercelActions =
    identity.runtime === "vercel" &&
    environment.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY === undefined &&
    actionsBuildFingerprint === null;
  const verifiedServerActions =
    actionsFingerprint !== null &&
    actionsBuildFingerprint !== null &&
    actionsFingerprint === actionsBuildFingerprint;
  const serverActions = verifiedServerActions
    ? "verified"
    : managedVercelActions
      ? "managed"
      : "unverified";
  const artifact = resolveArtifactStatus(environment, identity.runtime);
  const artifactSha256 = resolveArtifactSha256(environment, identity.runtime);
  // 분석은 선택 기능이다. 키가 없으면 disabled로 보고하되 readiness는 유지한다.
  const isReady =
    identity.revisionVerified &&
    configurationVerified &&
    artifact !== "unverified" &&
    serverActions !== "unverified";
  const status = kind === "live" || isReady ? 200 : 503;

  return Response.json(
    {
      service: identity.service,
      status: kind === "live" ? "alive" : isReady ? "ready" : "not_ready",
      runtime: identity.runtime,
      revision: identity.revisionVerified ? "verified" : "unverified",
      configuration: configurationVerified ? "verified" : "unverified",
      configurationFingerprint:
        publicBuildConfigFingerprint(publicConfig, identity.buildSha) ??
        "unavailable",
      artifact,
      artifactSha256,
      analytics: analyticsConfigured ? "configured" : "disabled",
      serverActions,
      serverActionsKeyFingerprint:
        verifiedServerActions
          ? actionsFingerprint
          : managedVercelActions
            ? "managed"
            : "unavailable",
      buildSha: identity.buildSha ?? "unknown",
      releaseSha: identity.releaseSha ?? "unknown",
    },
    {
      status,
      headers: { "Cache-Control": "no-store, max-age=0" },
    },
  );
}
