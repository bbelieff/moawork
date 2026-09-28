import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { chmod, chown, cp, link, lstat, mkdir, open, readFile, rename, rm, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { provisionAssetIdentity, renderProvisionAssets, verifyProvisionAssets } from "./assets.mjs";
import { canonicalJson, classifyRuntimeEnvironment, provisionManagedTargets, provisionManifestSha256, trustedBuilderIdentity, validateProvisionManifest } from "./manifest.mjs";

const SHA64 = /^[0-9a-f]{64}$/u;
const PRESTATE_KEYS = ["accounts", "auditSha256", "caddyRoot", "managedPaths", "preservedStateSha256", "schema", "servicesSha256"];
const CADDY_ROOT_PRESTATE_KEYS = ["digest", "endsWithNewline", "gid", "mode", "nlink", "path", "realpath", "uid", "unmanagedDigest"];
const execFile = promisify(execFileCallback);

function fail(code, message) {
  throw Object.assign(new Error(message), { name: "ProvisionInstallerError", code });
}

function cleanupFailure(error, provisionStepId, fallbackCode) {
  return Object.assign(new Error(`provision cleanup failed: ${provisionStepId}`, { cause: error }), {
    name: "ProvisionCleanupError",
    code: error?.code ?? fallbackCode,
    provisionStepId,
  });
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("PRESTATE_INVALID", `${label} must be an object`);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) fail("PRESTATE_INVALID", `${label} keys differ from the reviewed contract`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validatePrestate(prestate, manifest) {
  exactKeys(prestate, PRESTATE_KEYS, "prestate");
  if (prestate.schema !== "moawork-vps-provision-prestate-v1"
    || prestate.auditSha256 !== manifest.auditSha256
    || prestate.preservedStateSha256 !== manifest.preservedStateSha256
    || !SHA64.test(prestate.servicesSha256)) fail("PRESTATE_INVALID", "prestate identity differs from the manifest audit");
  exactKeys(prestate.accounts, ["deploy", "service"], "prestate.accounts");
  for (const key of ["deploy", "service"]) {
    const state = prestate.accounts[key];
    if (!state || state.state !== "absent" || Object.keys(state).length !== 1) fail("PRESTATE_CONFLICT", "dedicated accounts must be authoritatively absent before first provisioning");
  }
  if (!Array.isArray(prestate.managedPaths)) fail("PRESTATE_INVALID", "managedPaths must be an array");
  const byPath = new Map();
  for (const item of prestate.managedPaths) {
    exactKeys(item, ["path", "state"], "managedPaths entry");
    if (typeof item.path !== "string" || !["absent", "existing_preserved"].includes(item.state) || byPath.has(item.path)) fail("PRESTATE_INVALID", "managed path state is malformed");
    byPath.set(item.path, item.state);
  }
  const mustBeAbsent = provisionManagedTargets(manifest);
  for (const target of mustBeAbsent) if (byPath.get(target) !== "absent") fail("PRESTATE_CONFLICT", `managed target is not exact absent: ${target}`);
  if (byPath.get(manifest.paths.caddyConfigFile) !== "existing_preserved") fail("PRESTATE_CONFLICT", "the audited Caddy root must be preserved");
  exactKeys(prestate.caddyRoot, CADDY_ROOT_PRESTATE_KEYS, "prestate.caddyRoot");
  if (prestate.caddyRoot.path !== manifest.paths.caddyConfigFile || prestate.caddyRoot.realpath !== manifest.paths.caddyConfigFile
    || prestate.caddyRoot.nlink !== 1 || typeof prestate.caddyRoot.endsWithNewline !== "boolean" || !SHA64.test(prestate.caddyRoot.digest) || !SHA64.test(prestate.caddyRoot.unmanagedDigest)
    || !Number.isSafeInteger(prestate.caddyRoot.uid) || !Number.isSafeInteger(prestate.caddyRoot.gid)
    || typeof prestate.caddyRoot.mode !== "string" || !/^[0-7]{3,4}$/u.test(prestate.caddyRoot.mode)) {
    fail("PRESTATE_CONFLICT", "the audited Caddy root identity is incomplete");
  }
  return prestate;
}

function publicStep(id, kind, target, details = {}) {
  return Object.freeze({ id, kind, target, ...details });
}

export function buildProvisionPlan({
  manifest,
  auditSummary,
  prestate,
  runtimeEnvironment,
  nodeArchiveSha256,
  trustedBuilderBytes,
  assets = renderProvisionAssets(manifest),
}) {
  const validated = validateProvisionManifest(manifest, { auditSummary });
  validatePrestate(prestate, validated);
  const verifiedAssets = verifyProvisionAssets(validated, assets);
  if (nodeArchiveSha256 !== validated.node.archiveSha256) fail("NODE_ARCHIVE_MISMATCH", "Node archive does not match the reviewed manifest");
  const trustedIdentity = trustedBuilderIdentity(trustedBuilderBytes);
  if (trustedIdentity.bytesSha256 !== validated.trustedBuilder.bytesSha256 || trustedIdentity.fingerprintSha256 !== validated.trustedBuilder.fingerprintSha256) {
    fail("TRUSTED_BUILDER_MISMATCH", "trusted builder key identity does not match the reviewed manifest");
  }
  const environmentNames = classifyRuntimeEnvironment(runtimeEnvironment, validated.runtimeEnvironment.allowedNames);
  const steps = [
    publicStep("group-service", "create_group", validated.accounts.service.name, { gid: validated.accounts.service.gid }),
    publicStep("group-deploy", "create_group", validated.accounts.deploy.name, { gid: validated.accounts.deploy.gid }),
    publicStep("user-service", "create_user", validated.accounts.service.name, { uid: validated.accounts.service.uid, gid: validated.accounts.service.gid, shell: validated.accounts.service.shell, home: validated.accounts.service.home }),
    publicStep("user-deploy", "create_user", validated.accounts.deploy.name, { uid: validated.accounts.deploy.uid, gid: validated.accounts.deploy.gid, shell: validated.accounts.deploy.shell, home: validated.accounts.deploy.home, supplementaryGids: validated.accounts.deploy.supplementaryGids }),
    publicStep("release-root", "create_directory", validated.paths.releaseRoot, { owner: validated.accounts.deploy.name, group: validated.accounts.service.name, mode: "0750" }),
    publicStep("config-root", "create_directory", "/etc/moawork", { owner: "root", group: validated.accounts.service.name, mode: "0750" }),
    publicStep("caddy-managed", "create_directory", validated.paths.caddyManagedDirectory, { owner: validated.accounts.deploy.name, group: "root", mode: "0755" }),
    publicStep("node-root", "create_directory", path.posix.dirname(path.posix.dirname(path.posix.dirname(validated.paths.nodePath))), { owner: "root", group: "root", mode: "0755" }),
    publicStep("node-runtime", "install_node_archive", validated.paths.nodePath.replace(/\/bin\/node$/u, ""), { archiveSha256: validated.node.archiveSha256, version: validated.node.version, arch: validated.node.arch }),
    publicStep("runtime-env", "write_secret_file", validated.paths.runtimeEnvFile, { owner: "root", group: "root", mode: "0600", names: environmentNames, secretInputRef: "runtimeEnvironment" }),
    publicStep("trusted-builder", "write_trusted_builder", validated.paths.trustedBuilderPublicKeyPath, { owner: "root", group: validated.accounts.service.name, mode: "0440", bytesSha256: validated.trustedBuilder.bytesSha256, fingerprintSha256: validated.trustedBuilder.fingerprintSha256 }),
    ...["blueUnit", "greenUnit", "caddySite", "polkit", "releaseConfig"].map((key) => publicStep(`asset-${key}`, "write_asset", assets[key].path, { assetKey: key, sha256: assets[key].sha256, owner: assets[key].owner, group: assets[key].group, mode: assets[key].mode })),
    publicStep("caddy-import", "append_exact_line", assets.caddyImport.path, { assetKey: "caddyImport", sha256: assets.caddyImport.sha256, preserveExisting: true }),
    publicStep("systemd-reload", "systemctl_daemon_reload", validated.executables.systemctlPath),
    publicStep("caddy-validate", "caddy_validate", validated.executables.caddyPath, { config: validated.paths.caddyConfigFile, closureSha256: verifiedAssets.caddyClosureSha256 }),
    publicStep("enable-blue", "enable_unit", "moawork-web-blue.service", { start: false }),
    publicStep("enable-green", "enable_unit", "moawork-web-green.service", { start: false }),
  ];
  const manifestSha256 = provisionManifestSha256(validated, { auditSummary });
  const identity = {
    schema: "moawork-vps-provision-plan-v1",
    manifestSha256,
    auditSha256: validated.auditSha256,
    preservedStateSha256: validated.preservedStateSha256,
    servicesSha256: prestate.servicesSha256,
    prestate: structuredClone(prestate),
    assets: provisionAssetIdentity(assets),
    steps,
  };
  return Object.freeze({ ...identity, planSha256: sha256(canonicalJson(identity)) });
}

export async function executeProvisionPlan(plan, {
  apply = false,
  confirmPlanSha256 = null,
  executor = null,
} = {}) {
  if (!plan || plan.schema !== "moawork-vps-provision-plan-v1" || !SHA64.test(plan.planSha256 ?? "")) fail("PLAN_INVALID", "provision plan is malformed");
  const { planSha256, ...identity } = plan;
  if (sha256(canonicalJson(identity)) !== planSha256) fail("PLAN_INVALID", "provision plan identity changed");
  if (!apply) return Object.freeze({ applied: false, mode: "dry-run", planSha256, stepCount: plan.steps.length });
  if (confirmPlanSha256 !== planSha256) fail("CONFIRMATION_REQUIRED", "apply requires the exact reviewed plan SHA-256");
  if (!executor || typeof executor.begin !== "function" || typeof executor.apply !== "function" || typeof executor.rollback !== "function" || typeof executor.commit !== "function") {
    fail("EXECUTOR_INVALID", "apply requires the reviewed transactional executor");
  }
  const transaction = await executor.begin(plan);
  const applied = [];
  try {
    for (const step of plan.steps) {
      applied.push(step);
      await executor.apply(transaction, step);
    }
    await executor.commit(transaction, plan);
    return Object.freeze({ applied: true, mode: "apply", planSha256, stepCount: applied.length });
  } catch (error) {
    const rollbackErrors = [];
    for (const step of [...applied].reverse()) {
      try { await executor.rollback(transaction, step); }
      catch (rollbackError) { rollbackErrors.push(cleanupFailure(rollbackError, step.id, "ROLLBACK_FAILED")); }
    }
    try { await executor.recover?.(transaction, plan); }
    catch (recoveryError) { rollbackErrors.push(cleanupFailure(recoveryError, "recovery", "RECOVERY_FAILED")); }
    try { await executor.abort?.(transaction); }
    catch (abortError) { rollbackErrors.push(cleanupFailure(abortError, "abort", "ABORT_FAILED")); }
    if (rollbackErrors.length > 0) {
      throw Object.assign(
        new AggregateError([error, ...rollbackErrors], `provision failed and ${rollbackErrors.length} cleanup step(s) failed`, { cause: error }),
        { name: "ProvisionInstallerError", code: "ROLLBACK_INCOMPLETE" },
      );
    }
    throw Object.assign(new Error("provision failed and all applied steps were rolled back", { cause: error }), { name: "ProvisionInstallerError", code: "APPLY_ROLLED_BACK" });
  }
}

function envBytes(entries) {
  return `${[...entries].sort((a, b) => a.name.localeCompare(b.name)).map(({ name, value }) => `${name}=${JSON.stringify(value)}`).join("\n")}\n`;
}

export function createLinuxProvisionExecutor({
  manifest,
  assets,
  runtimeEnvironment,
  nodeArchivePath,
  trustedBuilderBytes,
  platform = process.platform,
  getuid = process.getuid?.bind(process),
  fs = { chmod, chown, cp, link, lstat, mkdir, open, readFile, rename, rm, rmdir, stat, unlink, writeFile },
  run = async (file, args) => execFile(file, args, { encoding: "utf8", maxBuffer: 1024 * 1024, shell: false }),
} = {}) {
  if (!manifest || !assets || !Array.isArray(runtimeEnvironment) || !Buffer.isBuffer(trustedBuilderBytes) || typeof nodeArchivePath !== "string") {
    fail("EXECUTOR_INVALID", "Linux executor inputs are incomplete");
  }
  const undo = new Map();

  async function atomicCreate(target, bytes, mode, uid, gid) {
    const temporary = `${target}.provision-${process.pid}.tmp`;
    let published = false;
    try {
      await fs.writeFile(temporary, bytes, { flag: "wx", mode: Number.parseInt(mode, 8) });
      await fs.chown(temporary, uid, gid);
      await fs.chmod(temporary, Number.parseInt(mode, 8));
      await fs.link(temporary, target);
      published = true;
      await fs.unlink(temporary);
    } catch (error) {
      const cleanupErrors = [];
      if (published) {
        try { await fs.unlink(target); }
        catch (cleanupError) { if (cleanupError?.code !== "ENOENT") cleanupErrors.push(cleanupError); }
      }
      try { await fs.unlink(temporary); }
      catch (cleanupError) { if (cleanupError?.code !== "ENOENT") cleanupErrors.push(cleanupError); }
      if (cleanupErrors.length > 0) throw new AggregateError([error, ...cleanupErrors], "no-clobber provision write and cleanup both failed");
      throw error;
    }
  }

  function sameIdentity(left, right) {
    return left && right && left.dev === right.dev && left.ino === right.ino;
  }

  async function regularIdentity(target, code) {
    const metadata = await fs.lstat(target);
    if (!metadata.isFile() || metadata.nlink !== 1) fail(code, `${target} must remain one regular non-linked file`);
    return metadata;
  }

  async function appendExactHeldFile(target, suffix, expected) {
    const handle = await fs.open(target, fsConstants.O_RDWR | fsConstants.O_APPEND);
    let original = null;
    let appendStarted = false;
    let result = null;
    let operationError = null;
    try {
      const held = await handle.stat();
      if (!held.isFile() || held.nlink !== 1 || !sameIdentity(held, expected)) fail("PRESTATE_CHANGED", `${target} changed before held-file append`);
      original = await handle.readFile();
      if (sha256(original) !== expected.digest) fail("PRESTATE_CHANGED", `${target} bytes changed before held-file append`);
      appendStarted = true;
      await handle.writeFile(suffix);
      await handle.sync();
      const [afterHeld, afterPath, afterBytes] = await Promise.all([
        handle.stat(),
        regularIdentity(target, "PRESTATE_CHANGED"),
        fs.readFile(target),
      ]);
      const expectedBytes = Buffer.concat([original, suffix]);
      if (afterHeld.nlink !== 1 || !sameIdentity(afterHeld, expected) || !sameIdentity(afterPath, expected) || !Buffer.from(afterBytes).equals(expectedBytes)) {
        fail("PRESTATE_CHANGED", `${target} pathname or bytes changed during held-file append`);
      }
      result = { published: { dev: afterHeld.dev, ino: afterHeld.ino, digest: sha256(expectedBytes) }, original };
    } catch (error) {
      if (appendStarted) error.caddyAppendMayRemain = true;
      operationError = error;
    }
    try {
      await handle.close();
    } catch (closeError) {
      if (operationError) {
        const combined = new AggregateError([operationError, closeError], "held-file append and descriptor close both failed", { cause: operationError });
        combined.code = operationError.code ?? closeError?.code;
        if (appendStarted) combined.caddyAppendMayRemain = true;
        throw combined;
      }
      if (appendStarted) closeError.caddyAppendMayRemain = true;
      throw closeError;
    }
    if (operationError) throw operationError;
    return result;
  }

  function retainCaddyForManualRecovery(transaction) {
    transaction.retainCaddyAssets = true;
    transaction.retainProvisionLock = true;
    fail("CADDY_RECOVERY_REQUIRED", "managed Caddy append is retained for exact manual recovery; automatic truncate is forbidden");
  }

  function ids(owner, group) {
    const account = owner === "root" ? { uid: 0 } : owner === manifest.accounts.service.name ? manifest.accounts.service : manifest.accounts.deploy;
    const groupAccount = group === "root" ? { gid: 0 } : group === manifest.accounts.service.name ? manifest.accounts.service : manifest.accounts.deploy;
    return { uid: account.uid, gid: groupAccount.gid };
  }

  async function closeLock(transaction) {
    if (!transaction?.lockPathOwned) return;
    if (transaction.lockHandleOpen) {
      await transaction.lock.close();
      transaction.lockHandleOpen = false;
    }
    try {
      const pathIdentity = await fs.lstat(manifest.paths.provisionLockFile);
      if (!sameIdentity(pathIdentity, transaction.lockIdentity)) fail("LOCK_OWNERSHIP_LOST", "provision lock pathname no longer names the owned lock");
      await fs.unlink(manifest.paths.provisionLockFile);
      transaction.lockPathOwned = false;
      transaction.lock = null;
    } catch (error) {
      throw error;
    }
  }

  async function assertAbsent(target) {
    try {
      await fs.lstat(target);
      fail("PRESTATE_CHANGED", `managed target appeared after audit: ${target}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  async function verifyLivePrestate(plan) {
    validatePrestate(plan.prestate, manifest);
    for (const target of provisionManagedTargets(manifest)) {
      if (target !== manifest.paths.provisionLockFile) await assertAbsent(target);
    }
    const expected = plan.prestate.caddyRoot;
    const current = await regularIdentity(expected.path, "PRESTATE_CHANGED");
    if (current.uid !== expected.uid || current.gid !== expected.gid
      || (current.mode & 0o777) !== Number.parseInt(expected.mode, 8)
      || expected.realpath !== expected.path || sha256(await fs.readFile(expected.path)) !== expected.digest) {
      fail("PRESTATE_CHANGED", "Caddy root changed after the reviewed audit");
    }
    return { dev: current.dev, ino: current.ino, digest: expected.digest };
  }

  return Object.freeze({
    async begin(plan) {
      if (platform !== "linux" || typeof getuid !== "function" || getuid() !== 0) fail("ROOT_REQUIRED", "apply requires Linux root after a reviewed dry-run");
      let lock;
      try { lock = await fs.open(manifest.paths.provisionLockFile, "wx", 0o600); }
      catch (error) { fail(error?.code === "EEXIST" ? "LOCK_BUSY" : "LOCK_FAILED", "exclusive provision lock could not be acquired"); }
      let lockIdentity;
      try {
        lockIdentity = await lock.stat();
        await lock.writeFile(`${JSON.stringify({ planSha256: plan.planSha256, pid: process.pid })}\n`);
        await lock.sync();
        const caddyRootIdentity = await verifyLivePrestate(plan);
        return { caddyRootIdentity, lock, lockHandleOpen: true, lockIdentity, lockPathOwned: true, systemdReloaded: false };
      } catch (error) {
        const cleanupErrors = [];
        try { await lock.close(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
        try {
          const pathIdentity = await fs.lstat(manifest.paths.provisionLockFile);
          if (!sameIdentity(pathIdentity, lockIdentity)) fail("LOCK_OWNERSHIP_LOST", "initialization cleanup refused a foreign provision lock");
          await fs.unlink(manifest.paths.provisionLockFile);
        } catch (cleanupError) { cleanupErrors.push(cleanupError); }
        if (cleanupErrors.length > 0) throw new AggregateError([error, ...cleanupErrors], "provision lock initialization and cleanup both failed");
        throw error;
      }
    },
    async apply(transaction, step) {
      if (step.kind === "create_group") {
        await run("/usr/sbin/groupadd", ["--gid", String(step.gid), step.target]);
        undo.set(step.id, async () => run("/usr/sbin/groupdel", [step.target]));
      } else if (step.kind === "create_user") {
        const args = ["--uid", String(step.uid), "--gid", String(step.gid), "--shell", step.shell];
        if (step.target === manifest.accounts.deploy.name) args.push("--create-home", "--home-dir", step.home);
        else args.push("--no-create-home", "--home-dir", step.home);
        args.push(step.target);
        await run("/usr/sbin/useradd", args);
        undo.set(step.id, async () => run("/usr/sbin/userdel", step.target === manifest.accounts.deploy.name ? ["--remove", step.target] : [step.target]));
        await run("/usr/sbin/usermod", ["--lock", step.target]);
        if (step.supplementaryGids?.length) await run("/usr/sbin/usermod", ["--append", "--groups", manifest.accounts.service.name, step.target]);
      } else if (step.kind === "create_directory") {
        const { uid, gid } = ids(step.owner, step.group);
        await fs.mkdir(step.target, { recursive: false, mode: Number.parseInt(step.mode, 8) });
        undo.set(step.id, async (transaction) => {
          if (transaction?.retainCaddyAssets && step.id === "caddy-managed") return;
          await fs.rmdir(step.target);
        });
        await fs.chown(step.target, uid, gid);
        await fs.chmod(step.target, Number.parseInt(step.mode, 8));
      } else if (step.kind === "install_node_archive") {
        const staging = `${step.target}.provision-${process.pid}`;
        const archiveStaging = `${step.target}.archive-${process.pid}`;
        const pinnedArchive = `${archiveStaging}/node-runtime.tar.xz`;
        await fs.mkdir(archiveStaging, { recursive: false, mode: 0o700 });
        try {
          const archiveBytes = await fs.readFile(nodeArchivePath);
          if (sha256(archiveBytes) !== step.archiveSha256) fail("NODE_ARCHIVE_MISMATCH", "Node archive changed after the reviewed plan");
          const archiveHandle = await fs.open(pinnedArchive, "wx", 0o600);
          try {
            await archiveHandle.writeFile(archiveBytes);
            await archiveHandle.sync();
          } finally {
            await archiveHandle.close();
          }
          await fs.mkdir(staging, { recursive: false, mode: 0o755 });
          await run("/usr/bin/tar", ["-xJf", pinnedArchive, "--strip-components=1", "-C", staging]);
          const version = (await run(`${staging}/bin/node`, ["--version"])).stdout.trim();
          if (version !== manifest.node.version) fail("NODE_RUNTIME_MISMATCH", "installed Node version differs from manifest");
          await fs.mkdir(step.target, { recursive: false, mode: 0o755 });
          undo.set(step.id, async () => fs.rm(step.target, { recursive: true, force: false }));
          await fs.cp(staging, step.target, { recursive: true, force: false, errorOnExist: true });
          await fs.rm(staging, { recursive: true, force: false });
        } catch (error) {
          await fs.rm(staging, { recursive: true, force: true });
          throw error;
        } finally {
          await fs.rm(archiveStaging, { recursive: true, force: true });
        }
      } else if (step.kind === "write_secret_file") {
        await atomicCreate(step.target, envBytes(runtimeEnvironment), step.mode, 0, 0);
        undo.set(step.id, async () => fs.unlink(step.target));
      } else if (step.kind === "write_trusted_builder") {
        const { uid, gid } = ids(step.owner, step.group);
        await atomicCreate(step.target, trustedBuilderBytes, step.mode, uid, gid);
        undo.set(step.id, async () => fs.unlink(step.target));
      } else if (step.kind === "write_asset") {
        const asset = assets[step.assetKey];
        const { uid, gid } = ids(step.owner, step.group);
        await atomicCreate(step.target, asset.bytes, step.mode, uid, gid);
        undo.set(step.id, async (transaction) => {
          if (transaction?.retainCaddyAssets && step.assetKey === "caddySite") return;
          await fs.unlink(step.target);
        });
      } else if (step.kind === "append_exact_line") {
        const asset = assets[step.assetKey];
        const before = await fs.readFile(step.target);
        const beforeStats = await fs.stat(step.target);
        if (!beforeStats.isFile() || beforeStats.nlink !== 1) fail("CADDY_IMPORT_CONFLICT", "Caddy root must be one regular non-linked file");
        const line = Buffer.from(asset.bytes);
        if (before.includes(line)) fail("CADDY_IMPORT_CONFLICT", "Caddy root already contains the managed import");
        try {
          await appendExactHeldFile(step.target, line, transaction.caddyRootIdentity);
          undo.set(step.id, async (rollbackTransaction) => retainCaddyForManualRecovery(rollbackTransaction));
        } catch (error) {
          if (error?.caddyAppendMayRemain === true) undo.set(step.id, async (rollbackTransaction) => retainCaddyForManualRecovery(rollbackTransaction));
          throw error;
        }
      } else if (step.kind === "systemctl_daemon_reload") {
        await run(step.target, ["daemon-reload"]);
        transaction.systemdReloaded = true;
      } else if (step.kind === "caddy_validate") {
        await run(step.target, ["validate", "--config", step.config]);
      } else if (step.kind === "enable_unit") {
        await run(manifest.executables.systemctlPath, ["enable", step.target]);
        undo.set(step.id, async () => run(manifest.executables.systemctlPath, ["disable", step.target]));
      } else fail("STEP_INVALID", `unknown provision step: ${step.kind}`);
    },
    async rollback(transaction, step) { await undo.get(step.id)?.(transaction); },
    async recover(transaction) {
      if (transaction.systemdReloaded) await run(manifest.executables.systemctlPath, ["daemon-reload"]);
    },
    async commit(transaction) { await closeLock(transaction); },
    async abort(transaction) {
      if (transaction.retainProvisionLock) return;
      await closeLock(transaction);
    },
  });
}
