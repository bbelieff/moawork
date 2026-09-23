import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

import {
  publicReleaseConfigDigest,
  ReleaseEnvironmentError,
  validateVpsReleaseEnvironment,
} from "./validate-vps-release-environment.mjs";

const SHA = "a".repeat(40);
const SUPABASE_URL = "https://srtvmpcosekduvsscsyz.supabase.co";
const PUBLISHABLE = `sb_publishable_${"p".repeat(24)}`;
const POSTHOG = `phc_${"h".repeat(24)}`;
const ACTIONS_KEY = Buffer.alloc(32, 7).toString("base64");

function jwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

function fixture(anonKey = PUBLISHABLE) {
  const config = { supabaseUrl: SUPABASE_URL, supabaseAnonKey: anonKey, posthogKey: POSTHOG };
  return {
    GITHUB_SHA: SHA,
    MOAWORK_BUILD_SHA: SHA,
    NEXT_PUBLIC_APP_VERSION: SHA,
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    NEXT_PUBLIC_POSTHOG_KEY: POSTHOG,
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: ACTIONS_KEY,
    MOAWORK_RELEASE_PUBLIC_CONFIG_SHA256: publicReleaseConfigDigest(config),
  };
}

function rejects(environment, code) {
  assert.throws(
    () => validateVpsReleaseEnvironment(environment),
    (error) => error instanceof ReleaseEnvironmentError && error.code === code,
  );
}

test("exact pinned publishable configuration passes without returning values", () => {
  assert.deepEqual(validateVpsReleaseEnvironment(fixture()), { sourceSha: SHA, supabaseProjectRef: "srtvmpcosekduvsscsyz" });
});

test("legacy JWT must be exact-project anon and never service_role", () => {
  const anon = jwt({ iss: "supabase", ref: "srtvmpcosekduvsscsyz", role: "anon" });
  assert.equal(validateVpsReleaseEnvironment(fixture(anon)).sourceSha, SHA);
  rejects(fixture(jwt({ iss: "supabase", ref: "srtvmpcosekduvsscsyz", role: "service_role" })), "RELEASE_SUPABASE_PUBLIC_KEY");
  rejects(fixture(jwt({ iss: "supabase", ref: "foreign", role: "anon" })), "RELEASE_SUPABASE_PUBLIC_KEY");
});

test("source, public configuration pin, analytics, and actions key fail closed", () => {
  rejects({ ...fixture(), NEXT_PUBLIC_APP_VERSION: "b".repeat(40) }, "RELEASE_SOURCE_IDENTITY");
  rejects({ ...fixture(), NEXT_PUBLIC_SUPABASE_URL: "https://foreign.supabase.co" }, "RELEASE_SUPABASE_ORIGIN");
  rejects({ ...fixture(), NEXT_PUBLIC_POSTHOG_KEY: "phc_short" }, "RELEASE_ANALYTICS_PUBLIC_KEY");
  rejects({ ...fixture(), NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: "not-base64" }, "RELEASE_SERVER_ACTIONS_KEY");
  rejects({ ...fixture(), MOAWORK_RELEASE_PUBLIC_CONFIG_SHA256: "b".repeat(64) }, "RELEASE_PUBLIC_CONFIG_PIN");
});

test("CLI output never includes public config values or the Server Actions key", () => {
  const result = spawnSync(process.execPath, [path.resolve(import.meta.dirname, "validate-vps-release-environment.mjs")], {
    encoding: "utf8",
    env: { ...process.env, ...fixture() },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "VPS_RELEASE_ENVIRONMENT_PASS");
  for (const value of [PUBLISHABLE, POSTHOG, ACTIONS_KEY]) assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(value, "u"));
});
