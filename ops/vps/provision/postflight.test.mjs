import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as auditContract from "../audit-contract.mjs";
import { renderProvisionAssets } from "./assets.mjs";
import { deriveProvisionAuditEvidence } from "./audit-evidence.mjs";
import { buildProvisionPlan } from "./installer.mjs";
import { verifyProvisionPostflight } from "./postflight.mjs";
import { provisionAuditReportFixture, provisionFixture, runtimeEnvironmentFixture } from "./test-fixtures.mjs";

const auditFile = fileURLToPath(new URL("../audit-host-readonly.sh", import.meta.url));

function shellPath(value) {
  if (process.platform !== "win32") return value;
  const match = value.match(/^([A-Za-z]):\\(.*)$/u);
  assert.ok(match, `unexpected Windows path: ${value}`);
  return `/${match[1].toLowerCase()}/${match[2].replaceAll("\\", "/")}`;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function collectCaddyFixture(caddyfile, caddy) {
  const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "/bin/bash";
  const command = `source ${shellQuote(shellPath(auditFile))}; collect_caddy_from_root ${shellQuote(shellPath(caddyfile))} ${shellQuote(shellPath(caddy))}; printf '%s\\n%s\\n%s' "\${PROBE_VALUE[caddy.root]}" "\${PROBE_VALUE[caddy.closure]}" "\${PROBE_VALUE[caddy.validate]}"`;
  const result = spawnSync(bash, ["--noprofile", "--norc", "-c", command], { encoding: "utf8", timeout: 60_000, killSignal: "SIGKILL" });
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  return result.stdout.trim().split("\n").map((line) => JSON.parse(line));
}

function fixture() {
  const { manifest, trustedBuilderBytes } = provisionFixture();
  let beforeAudit = provisionAuditReportFixture(manifest);
  manifest.auditSha256 = beforeAudit.provenance.evidenceDigest;
  manifest.preservedStateSha256 = auditContract.auditPreservedStateDigest(beforeAudit);
  beforeAudit = provisionAuditReportFixture(manifest);
  const evidence = deriveProvisionAuditEvidence(beforeAudit, manifest, auditContract, { nowMs: Date.parse(beforeAudit.observedAtUtc) });
  const assets = renderProvisionAssets(manifest);
  const plan = buildProvisionPlan({
    manifest,
    auditSummary: evidence.auditSummary,
    prestate: evidence.prestate,
    runtimeEnvironment: runtimeEnvironmentFixture(),
    nodeArchiveSha256: manifest.node.archiveSha256,
    trustedBuilderBytes,
    assets,
  });
  const afterAudit = provisionAuditReportFixture(manifest, { after: true });
  const managedAssets = Object.entries(assets).filter(([key]) => key !== "caddyImport").map(([assetKey, asset]) => {
    const owner = asset.owner === "root" ? { uid: 0 } : asset.owner === manifest.accounts.service.name ? manifest.accounts.service : manifest.accounts.deploy;
    const group = asset.group === "root" ? { gid: 0 } : asset.group === manifest.accounts.service.name ? manifest.accounts.service : manifest.accounts.deploy;
    return { assetKey, sha256: asset.sha256, uid: owner.uid, gid: group.gid, mode: asset.mode };
  }).sort((left, right) => left.assetKey.localeCompare(right.assetKey));
  const observed = {
    caddyImportOccurrences: 1,
    caddyValidated: true,
    environmentNames: [...manifest.runtimeEnvironment.allowedNames].sort(),
    managedAssets,
    node: { version: manifest.node.version, arch: manifest.node.arch },
    trustedBuilder: { sha256: manifest.trustedBuilder.bytesSha256, uid: 0, gid: manifest.accounts.service.gid, mode: "0440" },
    units: ["blue", "green"].map((slot) => ({
      slot,
      LoadState: "loaded",
      ActiveState: "inactive",
      SubState: "dead",
      UnitFileState: "enabled",
      FragmentPath: assets[`${slot}Unit`].path,
      fragmentPath: assets[`${slot}Unit`].path,
    })),
  };
  return { manifest, assets, plan, beforeAudit, afterAudit, observed, trustedBuilderBytes };
}

test("accepts only fresh host-observed postflight derived through the repository audit contract", async () => {
  const value = fixture();
  const result = await verifyProvisionPostflight({
    ...value,
    auditContract,
    nowMs: Date.parse("2026-09-09T07:35:00Z"),
    observe: async () => value.observed,
  });
  assert.deepEqual(result, {
    ok: true,
    planSha256: value.plan.planSha256,
    beforeAuditSha256: value.beforeAudit.provenance.evidenceDigest,
    afterAuditSha256: value.afterAudit.provenance.evidenceDigest,
  });
});

test("first-install empty managed Caddy import stays complete through collector, audit contract, and postflight", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moawork-postflight-caddy-empty-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const caddyfile = join(root, "Caddyfile");
  const managedDirectory = join(root, "moawork.d");
  const caddy = join(root, "caddy");
  const originalRoot = "example.test {\n respond 200\n}\n";
  await writeFile(caddyfile, originalRoot, "utf8");
  await writeFile(caddy, "#!/bin/sh\ncase \"$1\" in\n adapt) printf '{\"apps\":{}}\\n' ;;\n validate) exit 91 ;;\n *) exit 97 ;;\nesac\n", "utf8");
  await chmod(caddy, 0o755);
  const value = fixture();
  const [beforeRoot, beforeClosure, beforeValidate] = collectCaddyFixture(caddyfile, caddy);
  await mkdir(managedDirectory);
  await writeFile(join(root, "moawork.caddy"), `import ${shellPath(join(root, "moawork.d"))}/*.caddy\n`, "utf8");
  await writeFile(caddyfile, `${originalRoot}\n# Managed MoaWork import. Existing unrelated site blocks remain outside this file.\nimport ${shellPath(join(root, "moawork.caddy"))}\n`, "utf8");
  const [afterRoot, afterClosure, afterValidate] = collectCaddyFixture(caddyfile, caddy);
  assert.equal(afterClosure.complete, true);
  assert.equal(afterClosure.entryCount, 2);
  assert.equal(beforeRoot.managedImportOccurrences, 0);
  assert.equal(afterRoot.managedImportOccurrences, 1);
  assert.equal(beforeRoot.unmanagedDigest, afterRoot.unmanagedDigest);
  const pathDigest = (target) => createHash("sha256").update(target).digest("hex");
  for (const rootValue of [beforeRoot, afterRoot]) {
    rootValue.configPath = value.manifest.paths.caddyConfigFile;
    rootValue.realpath = value.manifest.paths.caddyConfigFile;
  }
  for (const validation of [beforeValidate, afterValidate]) validation.configPath = value.manifest.paths.caddyConfigFile;
  beforeClosure.entries[0].pathDigest = pathDigest(value.manifest.paths.caddyConfigFile);
  afterClosure.entries[0].pathDigest = pathDigest(value.manifest.paths.caddyConfigFile);
  afterClosure.entries[1].pathDigest = pathDigest(value.manifest.paths.caddySiteFile);
  value.beforeAudit.probes["caddy.root"] = { state: "ok", reasonCode: null, value: beforeRoot };
  value.beforeAudit.probes["caddy.closure"] = { state: "ok", reasonCode: null, value: beforeClosure };
  value.beforeAudit.probes["caddy.validate"] = { state: "ok", reasonCode: null, value: beforeValidate };
  value.beforeAudit.provenance.evidenceDigest = auditContract.auditEvidenceDigest(value.beforeAudit.probes, "host-observation");
  value.manifest.auditSha256 = value.beforeAudit.provenance.evidenceDigest;
  value.manifest.preservedStateSha256 = auditContract.auditPreservedStateDigest(value.beforeAudit);
  const evidence = deriveProvisionAuditEvidence(value.beforeAudit, value.manifest, auditContract, { nowMs: Date.parse(value.beforeAudit.observedAtUtc) });
  value.plan = buildProvisionPlan({
    manifest: value.manifest,
    auditSummary: evidence.auditSummary,
    prestate: evidence.prestate,
    runtimeEnvironment: runtimeEnvironmentFixture(),
    nodeArchiveSha256: value.manifest.node.archiveSha256,
    trustedBuilderBytes: value.trustedBuilderBytes,
    assets: value.assets,
  });
  value.afterAudit.probes["caddy.root"] = { state: "ok", reasonCode: null, value: afterRoot };
  value.afterAudit.probes["caddy.closure"] = { state: "ok", reasonCode: null, value: afterClosure };
  value.afterAudit.probes["caddy.validate"] = { state: "ok", reasonCode: null, value: afterValidate };
  value.afterAudit.provenance.evidenceDigest = auditContract.auditEvidenceDigest(value.afterAudit.probes, "host-observation");
  auditContract.validateHostAudit(value.afterAudit, { requireComplete: true });
  const result = await verifyProvisionPostflight({
    ...value,
    auditContract,
    nowMs: Date.parse("2026-09-09T07:35:00Z"),
    observe: async () => value.observed,
  });
  assert.equal(result.ok, true);
});

test("audit, plan, and postflight preserve empty, LF, CRLF, and no-final-newline Caddy roots byte-for-byte", async () => {
  for (const original of [Buffer.alloc(0), Buffer.from("site"), Buffer.from("site\n"), Buffer.from("site\r\n")]) {
    const value = fixture();
    const unmanagedDigest = createHash("sha256").update(original).digest("hex");
    const afterBytes = Buffer.concat([original, Buffer.from(value.assets.caddyImport.bytes)]);
    const afterDigest = createHash("sha256").update(afterBytes).digest("hex");
    const beforeRoot = value.beforeAudit.probes["caddy.root"].value;
    const afterRoot = value.afterAudit.probes["caddy.root"].value;
    Object.assign(beforeRoot, {
      digest: unmanagedDigest,
      unmanagedDigest,
      endsWithNewline: original.at(-1) === 0x0a,
      managedImportOccurrences: 0,
    });
    Object.assign(afterRoot, {
      digest: afterDigest,
      unmanagedDigest,
      endsWithNewline: true,
      managedImportOccurrences: 1,
    });
    value.beforeAudit.provenance.evidenceDigest = auditContract.auditEvidenceDigest(value.beforeAudit.probes, "host-observation");
    value.manifest.auditSha256 = value.beforeAudit.provenance.evidenceDigest;
    value.manifest.preservedStateSha256 = auditContract.auditPreservedStateDigest(value.beforeAudit);
    const evidence = deriveProvisionAuditEvidence(value.beforeAudit, value.manifest, auditContract, { nowMs: Date.parse(value.beforeAudit.observedAtUtc) });
    value.plan = buildProvisionPlan({
      manifest: value.manifest,
      auditSummary: evidence.auditSummary,
      prestate: evidence.prestate,
      runtimeEnvironment: runtimeEnvironmentFixture(),
      nodeArchiveSha256: value.manifest.node.archiveSha256,
      trustedBuilderBytes: value.trustedBuilderBytes,
      assets: value.assets,
    });
    value.afterAudit.provenance.evidenceDigest = auditContract.auditEvidenceDigest(value.afterAudit.probes, "host-observation");
    const result = await verifyProvisionPostflight({
      ...value,
      auditContract,
      nowMs: Date.parse("2026-09-09T07:35:00Z"),
      observe: async () => value.observed,
    });
    assert.equal(result.ok, true);
  }
});

test("fails closed on forged claims, fixture provenance, stale evidence, or host/preserved-state drift", async () => {
  const mutations = [
    (value) => { value.afterAudit.provenance.evidenceSource = "fixture"; },
    (value) => { value.afterAudit.observedAtUtc = "2026-09-09T07:00:00Z"; },
    (value) => { value.afterAudit.probes["identity.machine"].value.hostIdentityDigest = "0".repeat(64); },
    (value) => { value.afterAudit.probes["services.caddy"].value.restartCount = 1; },
    (value) => { value.observed.node.version = "v22.0.0"; },
    (value) => { value.observed.trustedBuilder.sha256 = "0".repeat(64); },
    (value) => { value.observed.managedAssets[0].sha256 = "0".repeat(64); },
    (value) => { value.observed.caddyImportOccurrences = 2; },
    (value) => {
      value.afterAudit.probes["caddy.closure"].value.entries.push({
        digest: "9".repeat(64), gid: 0, mode: "644", nlink: 1,
        pathDigest: "8".repeat(64), realpathDigest: "7".repeat(64), type: "regular file", uid: 0,
      });
      value.afterAudit.probes["caddy.closure"].value.entryCount += 1;
      value.afterAudit.provenance.evidenceDigest = auditContract.auditEvidenceDigest(value.afterAudit.probes, "host-observation");
    },
  ];
  for (const mutate of mutations) {
    const value = fixture();
    mutate(value);
    await assert.rejects(() => verifyProvisionPostflight({
      ...value,
      auditContract,
      nowMs: Date.parse("2026-09-09T07:35:00Z"),
      observe: async () => value.observed,
    }));
  }
});

test("rejects caller-authored legacy before/after assertions without reading host evidence", async () => {
  const value = fixture();
  let observed = false;
  await assert.rejects(() => verifyProvisionPostflight({
    manifest: value.manifest,
    plan: value.plan,
    beforeAudit: { auditSha256: value.manifest.auditSha256 },
    afterAudit: { schema: "moawork-vps-provision-postflight-v1", planSha256: value.plan.planSha256 },
    assets: value.assets,
    auditContract,
    observe: async () => { observed = true; return value.observed; },
  }));
  assert.equal(observed, false);
});
