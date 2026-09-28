import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";

import { deriveProvisionAuditEvidence } from "./audit-evidence.mjs";
import { canonicalJson, provisionManifestSha256 } from "./manifest.mjs";

const execFile = promisify(execFileCallback);

function fail(code, message) {
  throw Object.assign(new Error(message), { name: "ProvisionPostflightError", code });
}

function equal(actual, expected, code, message) {
  if (canonicalJson(actual) !== canonicalJson(expected)) fail(code, message);
}

function mode(stats) {
  return (stats.mode & 0o777).toString(8).padStart(4, "0");
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function unmanagedCaddyClosure(report, manifest) {
  const managed = new Set([
    manifest.paths.caddyConfigFile,
    manifest.paths.caddySiteFile,
    manifest.paths.upstreamFile,
  ].map((target) => digest(Buffer.from(target))));
  return report.probes["caddy.closure"].value.entries
    .filter((entry) => !managed.has(entry.pathDigest))
    .map((entry) => ({ ...entry }))
    .sort((left, right) => left.pathDigest.localeCompare(right.pathDigest));
}

function systemdProperties(stdout) {
  const entries = String(stdout).trim().split("\n").filter(Boolean).map((line) => {
    const index = line.indexOf("=");
    if (index <= 0) fail("POSTFLIGHT_OBSERVATION", "systemd returned malformed unit metadata");
    return [line.slice(0, index), line.slice(index + 1)];
  });
  return Object.fromEntries(entries);
}

function accountIds(manifest, owner, group) {
  const ownerAccount = owner === "root" ? { uid: 0 } : owner === manifest.accounts.service.name ? manifest.accounts.service : manifest.accounts.deploy;
  const groupAccount = group === "root" ? { gid: 0 } : group === manifest.accounts.service.name ? manifest.accounts.service : manifest.accounts.deploy;
  return { uid: ownerAccount.uid, gid: groupAccount.gid };
}

export async function collectProvisionPostflightState({
  manifest,
  assets,
  read = readFile,
  statPath = stat,
  run = async (file, args) => execFile(file, args, { encoding: "utf8", maxBuffer: 1024 * 1024, shell: false }),
} = {}) {
  const managedAssets = [];
  for (const [assetKey, asset] of Object.entries(assets)) {
    if (assetKey === "caddyImport") continue;
    const [bytes, metadata] = await Promise.all([read(asset.path), statPath(asset.path)]);
    if (!metadata.isFile() || metadata.nlink !== 1) fail("POSTFLIGHT_OBSERVATION", `managed asset is not one regular file: ${assetKey}`);
    managedAssets.push({ assetKey, sha256: digest(bytes), uid: metadata.uid, gid: metadata.gid, mode: mode(metadata) });
  }
  managedAssets.sort((left, right) => left.assetKey.localeCompare(right.assetKey));

  const runtimeBytes = await read(manifest.paths.runtimeEnvFile, "utf8");
  const environmentNames = String(runtimeBytes).split("\n").filter(Boolean).map((line) => {
    const index = line.indexOf("=");
    if (index <= 0) fail("POSTFLIGHT_OBSERVATION", "runtime environment file is malformed");
    return line.slice(0, index);
  }).sort();
  if (new Set(environmentNames).size !== environmentNames.length) fail("POSTFLIGHT_OBSERVATION", "runtime environment names are duplicated");

  const [trustedBuilderBytes, trustedBuilderStats] = await Promise.all([
    read(manifest.paths.trustedBuilderPublicKeyPath),
    statPath(manifest.paths.trustedBuilderPublicKeyPath),
  ]);
  if (!trustedBuilderStats.isFile() || trustedBuilderStats.nlink !== 1) fail("POSTFLIGHT_OBSERVATION", "trusted builder key is not one regular file");

  const caddyRoot = await read(manifest.paths.caddyConfigFile, "utf8");
  const importOccurrences = String(caddyRoot).split(String(assets.caddyImport.bytes)).length - 1;
  const [nodeVersion, nodeArch, caddyValidation] = await Promise.all([
    run(manifest.paths.nodePath, ["--version"]),
    run(manifest.paths.nodePath, ["-p", "process.arch"]),
    run(manifest.executables.caddyPath, ["validate", "--config", manifest.paths.caddyConfigFile, "--adapter", "caddyfile"]),
  ]);
  const units = [];
  for (const [slot, assetKey] of [["blue", "blueUnit"], ["green", "greenUnit"]]) {
    const asset = assets[assetKey];
    const result = await run(manifest.executables.systemctlPath, [
      "show",
      `moawork-web-${slot}.service`,
      "--property=LoadState,ActiveState,SubState,UnitFileState,FragmentPath",
    ]);
    units.push({ slot, ...systemdProperties(result.stdout), fragmentPath: asset.path });
  }
  return Object.freeze({
    caddyImportOccurrences: importOccurrences,
    caddyValidated: caddyValidation !== null,
    environmentNames,
    managedAssets,
    node: { version: nodeVersion.stdout.trim(), arch: nodeArch.stdout.trim() },
    trustedBuilder: { sha256: digest(trustedBuilderBytes), uid: trustedBuilderStats.uid, gid: trustedBuilderStats.gid, mode: mode(trustedBuilderStats) },
    units,
  });
}

function requireObservedPath(report, logicalKey, expected) {
  const entry = report.probes["filesystem.paths"].value.find((candidate) => candidate.logicalKey === logicalKey);
  if (!entry || entry.path !== expected.path || entry.type !== expected.type || entry.ancestorsSafe !== true) {
    fail("PATH_DRIFT", `postflight path differs: ${logicalKey}`);
  }
  for (const key of ["realpath", "uid", "gid", "mode"]) {
    if (expected[key] !== undefined && entry[key] !== expected[key]) fail("PATH_DRIFT", `postflight path metadata differs: ${logicalKey}.${key}`);
  }
  if (["regular file", "symbolic link"].includes(entry.type) && entry.nlink !== 1) fail("PATH_DRIFT", `postflight path link count differs: ${logicalKey}`);
  if (entry.type === "directory" && (!Number.isSafeInteger(entry.nlink) || entry.nlink < 2)) fail("PATH_DRIFT", `postflight directory link count differs: ${logicalKey}`);
  return entry;
}

export async function verifyProvisionPostflight({ manifest, plan, beforeAudit, afterAudit, assets, auditContract, nowMs = Date.now(), observe = collectProvisionPostflightState }) {
  if (!auditContract || typeof auditContract.validateHostAudit !== "function" || typeof auditContract.auditPreservedStateDigest !== "function") {
    fail("AUDIT_CONTRACT", "the repository audit-v2 contract is unavailable");
  }
  for (const report of [beforeAudit, afterAudit]) {
    auditContract.validateHostAudit(report, { requireComplete: true });
    if (report.provenance.evidenceSource !== "host-observation") fail("AUDIT_CONTRACT", "postflight requires actual host-observation evidence");
  }
  const beforeTime = Date.parse(beforeAudit.observedAtUtc);
  const afterTime = Date.parse(afterAudit.observedAtUtc);
  if (!Number.isFinite(beforeTime) || !Number.isFinite(afterTime) || afterTime <= beforeTime || afterTime > nowMs + 30_000 || nowMs - afterTime > 5 * 60_000) {
    fail("POSTFLIGHT_STALE", "postflight audit ordering or freshness is invalid");
  }
  const beforeEvidence = deriveProvisionAuditEvidence(beforeAudit, manifest, auditContract, { nowMs: beforeTime });
  const { planSha256, ...planIdentity } = plan;
  if (plan.schema !== "moawork-vps-provision-plan-v1"
    || digest(Buffer.from(canonicalJson(planIdentity))) !== planSha256
    || plan.auditSha256 !== beforeAudit.provenance.evidenceDigest
    || plan.manifestSha256 !== provisionManifestSha256(manifest, { auditSummary: beforeEvidence.auditSummary })) {
    fail("POSTFLIGHT_IDENTITY", "postflight does not describe the exact audited manifest and plan");
  }
  const beforeMachine = beforeAudit.probes["identity.machine"].value;
  const afterMachine = afterAudit.probes["identity.machine"].value;
  if (beforeMachine.hostIdentityDigest !== afterMachine.hostIdentityDigest || afterMachine.hostIdentityDigest !== manifest.auditHostIdentitySha256) {
    fail("POSTFLIGHT_IDENTITY", "postflight observations are not from the exact audited host");
  }
  const afterPreserved = auditContract.auditPreservedStateDigest(afterAudit);
  if (beforeEvidence.auditSummary.preservedStateSha256 !== manifest.preservedStateSha256 || afterPreserved !== manifest.preservedStateSha256) {
    fail("PRESERVED_STATE_DRIFT", "existing host services, executables, or global Node changed");
  }

  const accounts = afterAudit.probes["identity.accounts"].value;
  const byAccount = new Map(accounts.map((account) => [account.name, account]));
  for (const key of ["service", "deploy"]) {
    const expected = manifest.accounts[key];
    equal(byAccount.get(expected.name), { ...expected, present: true }, "ACCOUNT_DRIFT", `dedicated ${key} account differs from the manifest`);
  }

  requireObservedPath(afterAudit, "moawork.deployHome", { path: manifest.accounts.deploy.home, type: "directory", realpath: manifest.accounts.deploy.home, uid: manifest.accounts.deploy.uid, gid: manifest.accounts.deploy.gid });
  requireObservedPath(afterAudit, "moawork.root", { path: manifest.paths.releaseRoot, type: "directory", realpath: manifest.paths.releaseRoot, uid: manifest.accounts.deploy.uid, gid: manifest.accounts.service.gid, mode: "750" });
  requireObservedPath(afterAudit, "moawork.config", { path: "/etc/moawork", type: "directory", realpath: "/etc/moawork", uid: 0, gid: manifest.accounts.service.gid, mode: "750" });
  requireObservedPath(afterAudit, "caddy.managedDirectory", { path: manifest.paths.caddyManagedDirectory, type: "directory", realpath: manifest.paths.caddyManagedDirectory, uid: manifest.accounts.deploy.uid, gid: 0, mode: "755" });
  requireObservedPath(afterAudit, "global.nodeParent", { path: "/opt/moawork", type: "directory", realpath: "/opt/moawork", uid: 0, gid: 0, mode: "755" });
  const nodeRoot = manifest.paths.nodePath.replace(/\/bin\/node$/u, "");
  requireObservedPath(afterAudit, "global.nodeRoot", { path: nodeRoot, type: "directory", realpath: nodeRoot, uid: 0, gid: 0, mode: "755" });
  requireObservedPath(afterAudit, "global.nodeTarget", { path: manifest.paths.nodePath, type: "regular file", realpath: manifest.paths.nodePath, uid: 0, gid: 0 });
  requireObservedPath(afterAudit, "moawork.runtimeEnv", { path: manifest.paths.runtimeEnvFile, type: "regular file", realpath: manifest.paths.runtimeEnvFile, uid: 0, gid: 0, mode: "600" });
  requireObservedPath(afterAudit, "moawork.releaseConfig", { path: manifest.paths.releaseConfigFile, type: "regular file", realpath: manifest.paths.releaseConfigFile, uid: 0, gid: 0, mode: "644" });
  requireObservedPath(afterAudit, "moawork.trustedBuilderKey", { path: manifest.paths.trustedBuilderPublicKeyPath, type: "regular file", realpath: manifest.paths.trustedBuilderPublicKeyPath, uid: 0, gid: manifest.accounts.service.gid, mode: "440" });
  requireObservedPath(afterAudit, "systemd.policy", { path: manifest.paths.polkitRuleFile, type: "regular file", realpath: manifest.paths.polkitRuleFile, uid: 0, gid: 0, mode: "644" });
  requireObservedPath(afterAudit, "caddy.include", { path: manifest.paths.caddySiteFile, type: "regular file", realpath: manifest.paths.caddySiteFile, uid: 0, gid: 0, mode: "644" });
  requireObservedPath(afterAudit, "systemd.blue", { path: assets.blueUnit.path, type: "regular file", realpath: assets.blueUnit.path, uid: 0, gid: 0, mode: "644" });
  requireObservedPath(afterAudit, "systemd.green", { path: assets.greenUnit.path, type: "regular file", realpath: assets.greenUnit.path, uid: 0, gid: 0, mode: "644" });
  requireObservedPath(afterAudit, "systemd.blueEnabled", { path: "/etc/systemd/system/multi-user.target.wants/moawork-web-blue.service", type: "symbolic link", realpath: assets.blueUnit.path, uid: 0, gid: 0 });
  requireObservedPath(afterAudit, "systemd.greenEnabled", { path: "/etc/systemd/system/multi-user.target.wants/moawork-web-green.service", type: "symbolic link", realpath: assets.greenUnit.path, uid: 0, gid: 0 });
  for (const [logicalKey, path] of [["moawork.provisionLock", manifest.paths.provisionLockFile], ["moawork.releaseLock", manifest.paths.lockFile], ["moawork.releaseState", manifest.paths.stateFile], ["caddy.active", manifest.paths.upstreamFile]]) {
    requireObservedPath(afterAudit, logicalKey, { path, type: "absent", realpath: null, uid: null, gid: null, mode: null });
  }

  const ports = afterAudit.probes["listeners.candidatePorts"].value;
  for (const port of [manifest.ports.blue, manifest.ports.green]) {
    const matches = ports.filter((entry) => entry.port === port);
    if (matches.length !== 2 || matches.some((entry) => entry.listenCount !== 0 || entry.loopbackOnly !== true)) fail("PORT_DRIFT", "first provisioning must not start a slot listener");
  }
  const beforeCaddyRoot = beforeAudit.probes["caddy.root"].value;
  const afterCaddyRoot = afterAudit.probes["caddy.root"].value;
  if (beforeCaddyRoot.managedImportOccurrences !== 0 || afterCaddyRoot.managedImportOccurrences !== 1
    || beforeCaddyRoot.unmanagedDigest !== afterCaddyRoot.unmanagedDigest
    || canonicalJson(unmanagedCaddyClosure(beforeAudit, manifest)) !== canonicalJson(unmanagedCaddyClosure(afterAudit, manifest))) {
    fail("CADDY_DRIFT", "Caddy root changed beyond the one exact managed import block");
  }

  const observed = await observe({ manifest, assets });
  if (observed.caddyValidated !== true) fail("CADDY_DRIFT", "apply-phase Caddy module validation did not pass");
  equal(observed.environmentNames, [...manifest.runtimeEnvironment.allowedNames].sort(), "ENV_DRIFT", "runtime environment names differ from the manifest");
  equal(observed.node, { version: manifest.node.version, arch: manifest.node.arch }, "NODE_DRIFT", "dedicated Node runtime differs from the manifest");
  equal(observed.trustedBuilder, { sha256: manifest.trustedBuilder.bytesSha256, uid: 0, gid: manifest.accounts.service.gid, mode: "0440" }, "TRUSTED_BUILDER_DRIFT", "trusted builder key bytes or DAC differ from the manifest");
  if (observed.caddyImportOccurrences !== 1) fail("CADDY_DRIFT", "the exact managed Caddy import must occur once");
  const expectedAssets = Object.entries(assets).filter(([key]) => key !== "caddyImport").map(([assetKey, asset]) => {
    const ids = accountIds(manifest, asset.owner, asset.group);
    return { assetKey, sha256: asset.sha256, uid: ids.uid, gid: ids.gid, mode: asset.mode };
  }).sort((left, right) => left.assetKey.localeCompare(right.assetKey));
  equal(observed.managedAssets, expectedAssets, "ASSET_DRIFT", "managed asset bytes or DAC differ from the reviewed plan");
  for (const unit of observed.units) {
    const asset = assets[`${unit.slot}Unit`];
    if (unit.LoadState !== "loaded" || unit.ActiveState !== "inactive" || unit.SubState !== "dead" || unit.UnitFileState !== "enabled" || unit.FragmentPath !== asset.path || unit.fragmentPath !== asset.path) {
      fail("UNIT_DRIFT", `slot ${unit.slot} boot state differs from the no-start contract`);
    }
  }
  return Object.freeze({ ok: true, planSha256: plan.planSha256, beforeAuditSha256: beforeAudit.provenance.evidenceDigest, afterAuditSha256: afterAudit.provenance.evidenceDigest });
}
