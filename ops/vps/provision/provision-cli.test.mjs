import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import test from "node:test";

import * as auditContract from "../audit-contract.mjs";
import { renderProvisionAssets } from "./assets.mjs";
import { deriveProvisionAuditEvidence } from "./audit-evidence.mjs";
import { buildProvisionPlan } from "./installer.mjs";
import { runProvisionCli } from "./provision-cli.mjs";
import { provisionAuditReportFixture, provisionFixture, provisionPrestate, runtimeEnvironmentFixture } from "./test-fixtures.mjs";

function setup() {
  const { manifest, auditSummary, trustedBuilderBytes } = provisionFixture();
  const nodeBytes = Buffer.from("test node archive");
  manifest.node.archiveSha256 = createHash("sha256").update(nodeBytes).digest("hex");
  const paths = Object.fromEntries(["manifest", "audit", "runtime", "node", "key"].map((name) => [name, path.resolve(`C:/${name}.json`)]));
  const files = new Map([
    [paths.manifest, Buffer.from(JSON.stringify(manifest))],
    [paths.audit, Buffer.from(JSON.stringify({ complete: true }))],
    [paths.runtime, Buffer.from(JSON.stringify(runtimeEnvironmentFixture()))],
    [paths.node, nodeBytes],
    [paths.key, trustedBuilderBytes],
  ]);
  const dependencies = {
    readFile: async (target) => {
      if (!files.has(target)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return files.get(target);
    },
    auditContract: {},
    deriveProvisionAuditEvidence() { return { auditSummary, prestate: provisionPrestate(manifest) }; },
  };
  const common = ["--manifest", paths.manifest, "--audit", paths.audit, "--runtime-env", paths.runtime, "--node-archive", paths.node, "--trusted-builder", paths.key];
  return { dependencies, common, manifest };
}

test("plan is dry by construction and never emits runtime values", async () => {
  const value = setup();
  const result = await runProvisionCli(["plan", ...value.common], value.dependencies);
  assert.equal(result.applied, false);
  assert.match(result.plan.planSha256, /^[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(result).includes("abcdefghijklmnopqrst.supabase.co"), false);
});

test("apply uses the exact reconstructed plan and injected isolated executor", async () => {
  const value = setup();
  const planned = await runProvisionCli(["plan", ...value.common], value.dependencies);
  const seen = [];
  value.dependencies.executor = {
    async begin() { return {}; },
    async apply(_tx, step) { seen.push(step.id); },
    async rollback() {},
    async commit() {},
  };
  const result = await runProvisionCli(["apply", ...value.common, "--confirm-plan-sha256", planned.plan.planSha256], value.dependencies);
  assert.equal(result.applied, true);
  assert.equal(seen.length, planned.plan.steps.length);
});

test("unknown options and wrong confirmation fail before executor begin", async () => {
  const value = setup();
  let began = false;
  value.dependencies.executor = { async begin() { began = true; } };
  await assert.rejects(() => runProvisionCli(["plan", ...value.common, "--extra", path.resolve("C:/x")], value.dependencies));
  await assert.rejects(() => runProvisionCli(["apply", ...value.common, "--confirm-plan-sha256", "0".repeat(64)], value.dependencies));
  assert.equal(began, false);
});

test("production CLI cannot accept a caller-supplied auditSummary option", async () => {
  const value = setup();
  await assert.rejects(() => runProvisionCli(["plan", ...value.common, "--audit-summary", path.resolve("C:/forged.json")], value.dependencies));
});

test("postflight accepts only raw before/after audit paths and invokes the repository validator", async () => {
  const { manifest, trustedBuilderBytes } = provisionFixture();
  let beforeAudit = provisionAuditReportFixture(manifest);
  manifest.auditSha256 = beforeAudit.provenance.evidenceDigest;
  manifest.preservedStateSha256 = auditContract.auditPreservedStateDigest(beforeAudit);
  beforeAudit = provisionAuditReportFixture(manifest);
  const afterAudit = provisionAuditReportFixture(manifest, { after: true });
  const evidence = deriveProvisionAuditEvidence(beforeAudit, manifest, auditContract, { nowMs: Date.parse(beforeAudit.observedAtUtc) });
  const assets = renderProvisionAssets(manifest);
  const plan = buildProvisionPlan({ manifest, auditSummary: evidence.auditSummary, prestate: evidence.prestate, runtimeEnvironment: runtimeEnvironmentFixture(), nodeArchiveSha256: manifest.node.archiveSha256, trustedBuilderBytes, assets });
  const paths = Object.fromEntries(["manifest", "plan", "before", "after"].map((name) => [name, path.resolve(`C:/postflight-${name}.json`)]));
  const files = new Map([
    [paths.manifest, Buffer.from(JSON.stringify(manifest))],
    [paths.plan, Buffer.from(JSON.stringify(plan))],
    [paths.before, Buffer.from(JSON.stringify(beforeAudit))],
    [paths.after, Buffer.from(JSON.stringify(afterAudit))],
  ]);
  let observed = 0;
  const expectedAssets = Object.entries(assets).filter(([key]) => key !== "caddyImport").map(([assetKey, asset]) => ({ assetKey, sha256: asset.sha256, uid: 0, gid: asset.group === manifest.accounts.service.name ? manifest.accounts.service.gid : 0, mode: asset.mode })).sort((left, right) => left.assetKey.localeCompare(right.assetKey));
  const result = await runProvisionCli([
    "postflight", "--manifest", paths.manifest, "--plan", paths.plan, "--before-audit", paths.before, "--after-audit", paths.after,
  ], {
    readFile: async (target) => files.get(target),
    auditContract,
    nowMs: Date.parse("2026-09-09T07:35:00Z"),
    observePostflight: async () => {
      observed += 1;
      return {
        caddyImportOccurrences: 1,
        caddyValidated: true,
        environmentNames: [...manifest.runtimeEnvironment.allowedNames].sort(),
        managedAssets: expectedAssets,
        node: { version: manifest.node.version, arch: manifest.node.arch },
        trustedBuilder: { sha256: manifest.trustedBuilder.bytesSha256, uid: 0, gid: manifest.accounts.service.gid, mode: "0440" },
        units: ["blue", "green"].map((slot) => ({ slot, LoadState: "loaded", ActiveState: "inactive", SubState: "dead", UnitFileState: "enabled", FragmentPath: assets[`${slot}Unit`].path, fragmentPath: assets[`${slot}Unit`].path })),
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(observed, 1);
  await assert.rejects(() => runProvisionCli(["postflight", "--manifest", paths.manifest, "--plan", paths.plan, "--before", paths.before, "--after", paths.after], { readFile: async (target) => files.get(target), auditContract }));
});
