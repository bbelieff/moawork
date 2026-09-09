import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyRuntimeEnvironment,
  provisionManagedTargets,
  provisionManifestSha256,
  validateProvisionManifest,
} from "./manifest.mjs";
import { provisionFixture as fixture, runtimeEnvironmentFixture } from "./test-fixtures.mjs";

test("accepts one exact complete audited manifest deterministically", () => {
  const { auditSummary, manifest } = fixture();
  assert.deepEqual(validateProvisionManifest(manifest, { auditSummary }), manifest);
  assert.match(provisionManifestSha256(manifest, { auditSummary }), /^[0-9a-f]{64}$/u);
});

test("audits the deploy home before create-home and remove-home provisioning", () => {
  const { manifest } = fixture();
  const targets = provisionManagedTargets(manifest);
  assert.ok(targets.includes(manifest.accounts.deploy.home));
  assert.ok(targets.includes("/etc/moawork"));
  assert.ok(targets.includes(manifest.paths.caddyManagedDirectory));
  assert.ok(targets.includes(manifest.paths.provisionLockFile));
  assert.ok(targets.includes("/etc/systemd/system/multi-user.target.wants/moawork-web-blue.service"));
  assert.ok(targets.includes("/etc/systemd/system/multi-user.target.wants/moawork-web-green.service"));
});

test("rejects incomplete, mismatched, and fixture audit evidence", () => {
  const { auditSummary, manifest } = fixture();
  for (const patch of [
    { complete: false },
    { sha256: "0".repeat(64) },
    { machineArch: "arm64" },
    { hostIdentitySha256: "0".repeat(64) },
    { candidatePorts: [3101, 3103] },
    { preservedStateSha256: "0".repeat(64) },
  ]) {
    assert.throws(() => validateProvisionManifest(manifest, { auditSummary: { ...auditSummary, ...patch } }), /audit|ports|state/i);
  }
});

test("rejects privileged runtime credentials without disclosing values", () => {
  const secret = "sb_secret_DO_NOT_PRINT";
  assert.throws(
    () => classifyRuntimeEnvironment([{ name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", value: secret }], ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]),
    (error) => error.code === "SERVICE_ROLE_FORBIDDEN" && !error.message.includes(secret),
  );
  const encoded = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
  assert.throws(
    () => classifyRuntimeEnvironment([{ name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", value: `x.${encoded}.y` }], ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]),
    (error) => error.code === "SERVICE_ROLE_FORBIDDEN" && !error.message.includes(encoded),
  );
});

test("accepts only the reviewed runtime environment name set", () => {
  const entries = runtimeEnvironmentFixture();
  assert.deepEqual(
    classifyRuntimeEnvironment(entries, entries.map(({ name }) => name)),
    entries.map(({ name }) => name).sort(),
  );
  assert.throws(
    () => classifyRuntimeEnvironment([{ name: "SUPABASE_SERVICE_ROLE_KEY", value: "redacted" }], ["SUPABASE_SERVICE_ROLE_KEY"]),
    (error) => error.code === "SERVICE_ROLE_FORBIDDEN",
  );
});
