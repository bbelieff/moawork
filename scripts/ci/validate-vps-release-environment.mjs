#!/usr/bin/env node

import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHA40 = /^[0-9a-f]{40}$/u;
const SHA64 = /^[0-9a-f]{64}$/u;
const POSTHOG_PUBLIC_KEY = /^phc_[A-Za-z0-9_-]{20,}$/u;
const PUBLISHABLE_SUPABASE_KEY = /^sb_publishable_[A-Za-z0-9_-]{20,}$/u;
const EXPECTED_SUPABASE_ORIGIN = "https://srtvmpcosekduvsscsyz.supabase.co";

export class ReleaseEnvironmentError extends Error {
  constructor(code) {
    super(code);
    this.name = "ReleaseEnvironmentError";
    this.code = code;
  }
}

function fail(code) {
  throw new ReleaseEnvironmentError(code);
}

function canonicalBase64Key(value) {
  if (typeof value !== "string" || value !== value.trim() || /\s/u.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  return [16, 24, 32].includes(decoded.length) && decoded.toString("base64") === value ? decoded : null;
}

function decodeLegacyAnonKey(value) {
  const parts = typeof value === "string" ? value.split(".") : [];
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/u.test(part))) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload?.role === "anon" && payload?.ref === "srtvmpcosekduvsscsyz" && payload?.iss === "supabase"
      ? payload
      : null;
  } catch {
    return null;
  }
}

export function publicReleaseConfigDigest({ supabaseUrl, supabaseAnonKey, posthogKey }) {
  return createHash("sha256").update(JSON.stringify({ supabaseUrl, supabaseAnonKey, posthogKey })).digest("hex");
}

export function validateVpsReleaseEnvironment(environment = process.env) {
  const sourceSha = environment.GITHUB_SHA;
  if (!SHA40.test(sourceSha ?? "") || environment.MOAWORK_BUILD_SHA !== sourceSha || environment.NEXT_PUBLIC_APP_VERSION !== sourceSha) {
    fail("RELEASE_SOURCE_IDENTITY");
  }
  if (environment.NEXT_PUBLIC_SUPABASE_URL !== EXPECTED_SUPABASE_ORIGIN) fail("RELEASE_SUPABASE_ORIGIN");
  const anonKey = environment.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!PUBLISHABLE_SUPABASE_KEY.test(anonKey ?? "") && !decodeLegacyAnonKey(anonKey)) fail("RELEASE_SUPABASE_PUBLIC_KEY");
  if (!POSTHOG_PUBLIC_KEY.test(environment.NEXT_PUBLIC_POSTHOG_KEY ?? "")) fail("RELEASE_ANALYTICS_PUBLIC_KEY");
  if (!canonicalBase64Key(environment.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY)) fail("RELEASE_SERVER_ACTIONS_KEY");
  const expectedConfigDigest = environment.MOAWORK_RELEASE_PUBLIC_CONFIG_SHA256;
  if (!SHA64.test(expectedConfigDigest ?? "")) fail("RELEASE_PUBLIC_CONFIG_PIN");
  const actualConfigDigest = publicReleaseConfigDigest({
    supabaseUrl: environment.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: anonKey,
    posthogKey: environment.NEXT_PUBLIC_POSTHOG_KEY,
  });
  if (actualConfigDigest !== expectedConfigDigest) fail("RELEASE_PUBLIC_CONFIG_PIN");
  return Object.freeze({ sourceSha, supabaseProjectRef: "srtvmpcosekduvsscsyz" });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  try {
    validateVpsReleaseEnvironment();
    console.log("VPS_RELEASE_ENVIRONMENT_PASS");
  } catch (error) {
    console.error(`VPS_RELEASE_ENVIRONMENT_FAIL ${error instanceof ReleaseEnvironmentError ? error.code : "RELEASE_ENVIRONMENT_INTERNAL"}`);
    process.exitCode = 78;
  }
}
