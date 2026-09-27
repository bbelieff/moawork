import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { constants as fsConstants } from "node:fs";
import {
  access,
  chown,
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA64 = /^[0-9a-f]{64}$/u;
const SAFE_SLOT = /^[a-z][a-z0-9-]{0,31}$/u;
const SAFE_UNIT = /^moawork-[a-z0-9-]+[.]service$/u;
const FORBIDDEN_DEPLOYMENT = /(?:salespt|hermes)/iu;
const CONFIG_KEYS = [
  "caddyClosureSha256",
  "caddyConfigFile",
  "caddyImportLine",
  "caddyPath",
  "caddySiteFile",
  "caddySiteSha256",
  "caddyUnit",
  "lockFile",
  "nodePath",
  "nodeArch",
  "nodeVersion",
  "publicHealthUrl",
  "releaseRoot",
  "runtimeEnvFile",
  "schema",
  "serviceUser",
  "slotIds",
  "slots",
  "stateFile",
  "systemctlPath",
  "timeoutMs",
  "trustedBuilderPublicKeyPath",
  "upstreamFile",
];
const SLOT_KEYS = ["port", "releaseDir", "unit"];
const ARTIFACT_KEYS = [
  "assurance",
  "archivePath",
  "archiveSha256",
  "builder",
  "manifestPath",
  "manifestSha256",
  "releaseId",
  "schema",
  "serverActionsKeyFingerprint",
  "services",
  "sourceSha",
  "sourceTree",
];
const RUNTIME_ENV_NAME = ".moawork-release.env";
const ARTIFACT_STATE_NAME = ".moawork-artifact.json";
const ARTIFACT_CLI = fileURLToPath(new URL("../artifact/artifact.mjs", import.meta.url));
const ID_CLI = "/usr/bin/id";
const SYSTEMD_PROPERTIES = [
  "LoadState",
  "User",
  "Group",
  "WorkingDirectory",
  "EnvironmentFiles",
  "ExecStart",
  "Restart",
  "RestartUSec",
  "MemoryMax",
  "TasksMax",
  "CPUQuotaPerSecUSec",
  "StandardOutput",
  "StandardError",
  "SyslogIdentifier",
  "NoNewPrivileges",
  "PrivateTmp",
  "ProtectSystem",
  "ProtectHome",
  "ReadWritePaths",
];

export class LinuxReleaseRuntimeError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "LinuxReleaseRuntimeError";
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new LinuxReleaseRuntimeError(code, message, cause === undefined ? {} : { cause });
}

function exactKeys(value, expected, label, code = "invalid_config") {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code, `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail(code, `${label} keys are outside the reviewed contract`);
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeAbsolute(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || /[\s\u0000-\u001f]/u.test(value) || !path.isAbsolute(value)) {
    fail("invalid_config", `${label} must be one canonical absolute path`);
  }
  const resolved = path.resolve(value);
  if (resolved !== value || resolved === path.parse(resolved).root || FORBIDDEN_DEPLOYMENT.test(resolved)) {
    fail("invalid_config", `${label} is outside the dedicated MoaWork path contract`);
  }
  return resolved;
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function artifactIdentity(artifact) {
  return {
    releaseId: artifact.releaseId,
    sourceSha: artifact.sourceSha,
    sourceTree: artifact.sourceTree,
    archiveSha256: artifact.archiveSha256,
    manifestSha256: artifact.manifestSha256,
    serverActionsKeyFingerprint: artifact.serverActionsKeyFingerprint,
    builder: artifact.builder,
    assurance: artifact.assurance,
    services: artifact.services,
  };
}

function artifactTransportIdentity(artifact) {
  const { assurance: _assurance, ...identity } = artifactIdentity(artifact);
  return identity;
}

function identitiesEqual(left, right) {
  return JSON.stringify(artifactIdentity(left)) === JSON.stringify(artifactIdentity(right));
}

function validateArtifact(artifact, label = "artifact") {
  exactKeys(artifact, ARTIFACT_KEYS, label);
  if (
    artifact.schema !== 1
    || !SHA64.test(artifact.releaseId)
    || artifact.releaseId !== artifact.archiveSha256
    || !SHA64.test(artifact.manifestSha256)
    || !SHA40.test(artifact.sourceSha)
    || !SHA40.test(artifact.sourceTree)
    || !path.isAbsolute(artifact.archivePath)
    || !path.isAbsolute(artifact.manifestPath)
    || JSON.stringify(Object.keys(artifact.builder ?? {}).sort()) !== JSON.stringify(["arch", "nodeVersion", "npmVersion", "platform"])
    || artifact.builder.platform !== "linux"
    || JSON.stringify(Object.keys(artifact.assurance ?? {}).sort()) !== JSON.stringify(["builderTrustVerified", "linuxAbiVerified", "signed", "transportIntegrityOnly"])
    || artifact.assurance.builderTrustVerified !== true
    || artifact.assurance.linuxAbiVerified !== true
    || artifact.assurance.signed !== true
    || artifact.assurance.transportIntegrityOnly !== false
    || JSON.stringify(artifact.services) !== JSON.stringify([{ serviceKey: "web", payloadRoot: "runtime" }])
  ) fail("artifact_invalid", `${label} identity is malformed`);
  return structuredClone(artifact);
}

function normalizeConfig(input) {
  exactKeys(input, CONFIG_KEYS, "runtime config");
  if (input.schema !== 1) fail("invalid_config", "runtime config schema must be 1");
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 300_000) {
    fail("invalid_config", "timeoutMs is outside the reviewed bound");
  }
  if (!Array.isArray(input.slotIds) || input.slotIds.length !== 2 || new Set(input.slotIds).size !== 2) {
    fail("invalid_config", "exactly two distinct slot ids are required");
  }
  for (const slot of input.slotIds) if (typeof slot !== "string" || !SAFE_SLOT.test(slot)) fail("invalid_config", "slot id is unsafe");
  exactKeys(input.slots, input.slotIds, "slots");

  const releaseRoot = safeAbsolute(input.releaseRoot, "releaseRoot");
  const slots = {};
  const ports = new Set();
  for (const slot of input.slotIds) {
    exactKeys(input.slots[slot], SLOT_KEYS, `slots.${slot}`);
    const port = input.slots[slot].port;
    const releaseDir = safeAbsolute(input.slots[slot].releaseDir, `slots.${slot}.releaseDir`);
    const unit = input.slots[slot].unit;
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65535 || ports.has(port)) fail("invalid_config", "slot ports must be distinct unprivileged loopback ports");
    if (releaseDir !== path.join(releaseRoot, slot)) fail("invalid_config", "each slot release directory must be the exact named child of releaseRoot");
    if (typeof unit !== "string" || !SAFE_UNIT.test(unit) || FORBIDDEN_DEPLOYMENT.test(unit) || unit !== `moawork-web-${slot}.service`) {
      fail("invalid_config", "slot service unit is outside the MoaWork allowlist");
    }
    ports.add(port);
    slots[slot] = Object.freeze({ port, releaseDir, unit });
  }

  const stateFile = safeAbsolute(input.stateFile, "stateFile");
  const lockFile = safeAbsolute(input.lockFile, "lockFile");
  const runtimeEnvFile = safeAbsolute(input.runtimeEnvFile, "runtimeEnvFile");
  const upstreamFile = safeAbsolute(input.upstreamFile, "upstreamFile");
  const caddyConfigFile = safeAbsolute(input.caddyConfigFile, "caddyConfigFile");
  const caddySiteFile = safeAbsolute(input.caddySiteFile, "caddySiteFile");
  const systemctlPath = safeAbsolute(input.systemctlPath, "systemctlPath");
  const caddyPath = safeAbsolute(input.caddyPath, "caddyPath");
  const nodePath = safeAbsolute(input.nodePath, "nodePath");
  const trustedBuilderPublicKeyPath = safeAbsolute(input.trustedBuilderPublicKeyPath, "trustedBuilderPublicKeyPath");
  if (path.basename(systemctlPath) !== "systemctl" || path.basename(caddyPath) !== "caddy" || !/^node(?:[.]exe)?$/u.test(path.basename(nodePath))) fail("invalid_config", "only direct systemctl, caddy, and Node executables are accepted");
  if (input.caddyUnit !== "caddy.service") fail("invalid_config", "the Caddy unit must be caddy.service");
  if (typeof input.serviceUser !== "string" || !/^[a-z_][a-z0-9_-]{0,31}$/u.test(input.serviceUser) || input.serviceUser === "root" || FORBIDDEN_DEPLOYMENT.test(input.serviceUser)) {
    fail("invalid_config", "serviceUser must be one dedicated non-root account");
  }
  if (!SHA64.test(input.caddySiteSha256) || !SHA64.test(input.caddyClosureSha256)) fail("invalid_config", "Caddy managed closure digest is malformed");
  if (input.caddyImportLine !== `import ${caddySiteFile}`) fail("invalid_config", "Caddy root import line differs from the exact managed site");
  if (path.dirname(upstreamFile) === path.dirname(caddySiteFile) || path.dirname(upstreamFile) !== `${path.dirname(caddySiteFile)}${path.sep}moawork.d`) {
    fail("invalid_config", "Caddy managed upstream directory is not the exact child of the managed site directory");
  }
  if (typeof input.nodeArch !== "string" || input.nodeArch.length === 0 || !/^v[0-9]+[.][0-9]+[.][0-9]+$/u.test(input.nodeVersion ?? "")) {
    fail("invalid_config", "audited Node builder identity is malformed");
  }
  const dedicatedPaths = [stateFile, lockFile, runtimeEnvFile, upstreamFile, caddyConfigFile, caddySiteFile, systemctlPath, caddyPath, nodePath, trustedBuilderPublicKeyPath];
  if (new Set(dedicatedPaths).size !== dedicatedPaths.length) {
    fail("invalid_config", "release state, routing, executable, and trust paths must be pairwise distinct");
  }
  for (const candidate of dedicatedPaths) {
    if (inside(releaseRoot, candidate)) fail("invalid_config", "mutable state, secrets, routing, and executables must stay outside releaseRoot");
  }
  let publicHealthUrl;
  try {
    publicHealthUrl = new URL(input.publicHealthUrl);
  } catch {
    fail("invalid_config", "publicHealthUrl is malformed");
  }
  if (
    publicHealthUrl.protocol !== "https:"
    || publicHealthUrl.username !== ""
    || publicHealthUrl.password !== ""
    || publicHealthUrl.search !== ""
    || publicHealthUrl.hash !== ""
    || publicHealthUrl.pathname !== "/api/health/ready"
    || FORBIDDEN_DEPLOYMENT.test(publicHealthUrl.hostname)
  ) fail("invalid_config", "publicHealthUrl must be the exact HTTPS MoaWork readiness endpoint");

  return Object.freeze({
    ...input,
    releaseRoot,
    stateFile,
    lockFile,
    runtimeEnvFile,
    upstreamFile,
    caddyConfigFile,
    caddySiteFile,
    systemctlPath,
    caddyPath,
    nodePath,
    trustedBuilderPublicKeyPath,
    publicHealthUrl: publicHealthUrl.href,
    slotIds: Object.freeze([...input.slotIds]),
    slots: Object.freeze(slots),
  });
}

async function pathExists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function assertRegular(target, label, { privateFile = false } = {}) {
  const value = await lstat(target, { bigint: true }).catch((error) => fail("host_contract", `${label} is unavailable`, error));
  if (!value.isFile() || value.isSymbolicLink()) fail("host_contract", `${label} must be a regular non-link file`);
  if (process.platform === "linux" && privateFile && (value.mode & 0o077n) !== 0n) fail("host_contract", `${label} must not grant group/other permissions`);
  return value;
}

async function assertDirectory(target, label, { writable = false } = {}) {
  const value = await lstat(target).catch((error) => fail("host_contract", `${label} is unavailable`, error));
  if (!value.isDirectory() || value.isSymbolicLink()) fail("host_contract", `${label} must be a real directory`);
  if (writable) await access(target, fsConstants.W_OK).catch((error) => fail("host_contract", `${label} is not writable by the deploy user`, error));
  return value;
}

function physicalIdentity(stats) {
  return `${stats.dev}:${stats.ino}`;
}

async function inspectPhysicalPath(target, label, { allowMissingFinal = false, requireOtherTraverse = false, lstatImpl = lstat } = {}) {
  const root = path.parse(target).root;
  const segments = path.relative(root, target).split(path.sep).filter(Boolean);
  let current = root;
  const rootStats = await lstatImpl(root, { bigint: true }).catch((error) => fail("host_contract", `${label} filesystem root is unavailable`, error));
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) fail("host_contract", `${label} filesystem root must be a real directory`);
  const components = [{ path: root, stats: rootStats }];
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stats;
    try {
      stats = await lstatImpl(current, { bigint: true });
    } catch (error) {
      if (error?.code === "ENOENT" && allowMissingFinal && index === segments.length - 1) {
        return {
          exists: false,
          components,
          parentRealPath: await realpath(path.dirname(target)).catch((cause) => fail("host_contract", `${label} parent cannot be resolved physically`, cause)),
          realPath: null,
          stats: null,
        };
      }
      fail("host_contract", `${label} path component is unavailable`, error);
    }
    if (stats.isSymbolicLink()) fail("host_contract", `${label} must not traverse a symlink or junction`);
    if (index < segments.length - 1 && !stats.isDirectory()) fail("host_contract", `${label} ancestor must be a real directory`);
    if (
      process.platform === "linux"
      && requireOtherTraverse
      && stats.isDirectory()
      && (stats.mode & 0o001n) === 0n
    ) fail("host_contract", `${label} must be traversable by the distinct service identity`);
    components.push({ path: current, stats });
  }
  return {
    exists: true,
    components,
    parentRealPath: await realpath(path.dirname(target)).catch((error) => fail("host_contract", `${label} parent cannot be resolved physically`, error)),
    realPath: await realpath(target).catch((error) => fail("host_contract", `${label} cannot be resolved physically`, error)),
    stats: await lstatImpl(target, { bigint: true }).catch((error) => fail("host_contract", `${label} is unavailable`, error)),
  };
}

function samePhysicalEntry(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function releaseEntrySnapshot(relativePath, stats) {
  return {
    path: relativePath,
    type: stats.isDirectory() ? "directory" : "file",
    dev: stats.dev.toString(),
    ino: stats.ino.toString(),
    mode: (stats.mode & 0o777n).toString(8),
    uid: stats.uid.toString(),
    gid: stats.gid.toString(),
    size: stats.size.toString(),
  };
}

function sealIdentity(entries) {
  const sorted = [...entries].sort((left, right) => left.path.localeCompare(right.path));
  return Object.freeze({ schema: 1, digest: sha256(Buffer.from(canonicalJson(sorted), "utf8")) });
}

function validateSealIdentity(value, label = "release seal") {
  exactKeys(value, ["digest", "schema"], label, "state_invalid");
  if (value.schema !== 1 || !SHA64.test(value.digest)) fail("state_invalid", `${label} is malformed`);
  return { schema: 1, digest: value.digest };
}

function physicallyInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function recordPhysicalAlias(identities, target, stats, label) {
  const identity = physicalIdentity(stats);
  const prior = identities.get(identity);
  if (prior && prior.target !== target) fail("host_contract", `${label} aliases ${prior.label}`);
  identities.set(identity, { label, target });
}

function parseSystemdProperties(output) {
  if (typeof output !== "string") fail("host_contract", "systemd show output is unavailable");
  const lines = output.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length !== SYSTEMD_PROPERTIES.length || lines.some((line) => line.length === 0)) {
    fail("host_contract", "systemd show returned missing, extra, or empty properties");
  }
  const values = new Map();
  for (const line of lines) {
    const separator = line.indexOf("=");
    if (separator <= 0) fail("host_contract", "systemd show returned a malformed property");
    const key = line.slice(0, separator);
    if (!SYSTEMD_PROPERTIES.includes(key) || values.has(key)) fail("host_contract", "systemd show returned an unknown or duplicate property");
    values.set(key, line.slice(separator + 1));
  }
  if (values.size !== SYSTEMD_PROPERTIES.length) fail("host_contract", "systemd show did not return the exact property set");
  return values;
}

function parseBoundedInteger(value, label, minimum, maximum) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) fail("host_contract", `${label} must be one canonical integer`);
  const numeric = BigInt(value);
  if (numeric < minimum || numeric > maximum) fail("host_contract", `${label} is outside the reviewed bound`);
  return numeric;
}

function parseBoundedMicroseconds(value, label, minimum, maximum) {
  const match = /^(0|[1-9][0-9]*)(us|ms|s|min|h)?$/u.exec(value);
  if (!match) fail("host_contract", `${label} must be one canonical duration`);
  const factors = { us: 1n, ms: 1_000n, s: 1_000_000n, min: 60_000_000n, h: 3_600_000_000n };
  const numeric = BigInt(match[1]) * factors[match[2] ?? "us"];
  if (numeric < minimum || numeric > maximum) fail("host_contract", `${label} is outside the reviewed bound`);
  return numeric;
}

function exactExecStart(value, nodePath) {
  const prefix = `{ path=${nodePath} ; argv[]=${nodePath} server.js ;`;
  if (!value.startsWith(prefix)) return false;
  const suffix = value.slice(prefix.length);
  if (suffix === " }") return true;
  return /^ ignore_errors=(?:yes|no) ; start_time=\[[^\]\r\n]+\] ; stop_time=\[[^\]\r\n]+\] ; pid=[0-9]+ ; code=[^;\r\n]+ ; status=[0-9]+\/[0-9]+ ; \}$/u.test(suffix);
}

async function atomicWrite(target, bytes, mode = 0o600, assertMutable = () => {}) {
  const parent = path.dirname(target);
  await assertDirectory(parent, "atomic write parent", { writable: true });
  if (await pathExists(target)) await assertRegular(target, "atomic write target");
  const temporary = path.join(parent, `.${path.basename(target)}.${randomUUID()}.tmp`);
  assertMutable();
  const handle = await open(temporary, "wx", mode);
  try {
    assertMutable();
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  assertMutable();
  await chmod(temporary, mode);
  assertMutable();
  await rename(temporary, target);
}

export async function defaultCommandRunner({ file, args, signal, registerTermination }) {
  return new Promise((resolve, reject) => {
    let callbackResult = null;
    let closeObserved = false;
    let settled = false;
    const settle = () => {
      if (settled || callbackResult === null || !closeObserved) return;
      settled = true;
      const { error, stdout, stderr } = callbackResult;
      if (error) reject(new LinuxReleaseRuntimeError("command_failed", `${path.basename(file)} command failed`, { cause: error }));
      else resolve({ stdout, stderr });
    };
    const child = execFileCallback(file, args, { encoding: "utf8", maxBuffer: 1024 * 1024, shell: false, signal, windowsHide: true }, (error, stdout, stderr) => {
      callbackResult = { error, stdout, stderr };
      settle();
    });
    child.once("close", () => {
      closeObserved = true;
      settle();
    });
    registerTermination?.(async () => {
      if (closeObserved) return true;
      child.kill("SIGKILL");
      await Promise.race([
        new Promise((done) => child.once("close", done)),
        new Promise((done) => setTimeout(done, 500)),
      ]);
      return closeObserved;
    });
  });
}

async function defaultMaterializeArtifact({ artifact, destinationPath, signal, registerTermination }) {
  let result;
  try {
    result = await defaultCommandRunner({
      file: process.execPath,
      args: [
        ARTIFACT_CLI,
        "verify",
        "--archive",
        artifact.archivePath,
        "--manifest",
        artifact.manifestPath,
        "--destination",
        destinationPath,
      ],
      signal,
      registerTermination,
    });
  } catch (error) {
    fail("artifact_materialize_failed", "artifact materialization failed", error);
  }
  try {
    const transportVerified = JSON.parse(result.stdout);
    if (JSON.stringify(artifactTransportIdentity(transportVerified)) !== JSON.stringify(artifactTransportIdentity(artifact))) {
      fail("artifact_materialize_failed", "materialized transport identity differs from trusted provenance");
    }
    return {
      ...transportVerified,
      builder: artifact.builder,
      assurance: artifact.assurance,
    };
  } catch (error) {
    fail("artifact_materialize_failed", "artifact verifier returned malformed output", error);
  }
}

async function defaultResolveServiceIdentity({ user }) {
  async function readId(argument, label) {
    let output;
    try {
      output = (await execFile(ID_CLI, [argument, user], {
        encoding: "utf8",
        maxBuffer: 4096,
        shell: false,
        windowsHide: true,
      })).stdout.trim();
    } catch (error) {
      fail("host_contract", `service ${label} could not be resolved`, error);
    }
    if (!/^(?:0|[1-9][0-9]*)$/u.test(output)) fail("host_contract", `service ${label} is malformed`);
    const value = BigInt(output);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail("host_contract", `service ${label} is outside the reviewed bound`);
    return value;
  }
  let groupOutput;
  try {
    groupOutput = (await execFile(ID_CLI, ["-G", user], {
      encoding: "utf8",
      maxBuffer: 4096,
      shell: false,
      windowsHide: true,
    })).stdout.trim();
  } catch (error) {
    fail("host_contract", "service supplementary groups could not be resolved", error);
  }
  if (!/^(?:0|[1-9][0-9]*)(?: (?:0|[1-9][0-9]*))*$/u.test(groupOutput)) fail("host_contract", "service supplementary groups are malformed");
  const groups = [...new Set(groupOutput.split(" ").map((value) => BigInt(value)))];
  if (groups.some((value) => value > BigInt(Number.MAX_SAFE_INTEGER))) fail("host_contract", "service supplementary group is outside the reviewed bound");
  const gid = await readId("-g", "primary gid");
  if (!groups.includes(gid)) fail("host_contract", "service primary gid is absent from its exact group set");
  return { uid: await readId("-u", "uid"), gid, groups };
}

function emptyStatus(config) {
  return {
    schema: 1,
    generation: 0,
    activeSlot: null,
    previousSlot: null,
    recovery: null,
    slots: Object.fromEntries(config.slotIds.map((slot) => [slot, { state: "empty", artifact: null, seal: null }])),
  };
}

function validateState(value, config) {
  exactKeys(value, ["activeSlot", "generation", "previousSlot", "recovery", "schema", "slots"], "release state", "state_invalid");
  if (value.schema !== 1 || !Number.isSafeInteger(value.generation) || value.generation < 0) fail("state_invalid", "release state header is invalid");
  for (const key of ["activeSlot", "previousSlot"]) if (value[key] !== null && !config.slotIds.includes(value[key])) fail("state_invalid", `${key} is outside configured slots`);
  if (value.activeSlot !== null && value.activeSlot === value.previousSlot) fail("state_invalid", "active and previous slots must differ");
  if (value.recovery !== null) {
    if (value.recovery.kind === "service_state_unknown") {
      exactKeys(value.recovery, ["expectedActive", "kind", "operation", "slot"], "release recovery marker");
      if (
        !config.slotIds.includes(value.recovery.slot)
        || !["stop", "restart", "compensating_stop", "compensating_restart"].includes(value.recovery.operation)
        || typeof value.recovery.expectedActive !== "boolean"
      ) fail("state_invalid", "service recovery marker is malformed");
    } else if (value.recovery.kind === "release_cleanup_unknown") {
      exactKeys(value.recovery, ["kind", "operation", "slot"], "release recovery marker");
      if (!config.slotIds.includes(value.recovery.slot) || value.recovery.operation !== "reject") {
        fail("state_invalid", "release cleanup marker is malformed");
      }
    } else {
      exactKeys(value.recovery, ["expectedActiveSlot", "expectedGeneration", "kind", "targetSlot"], "release recovery marker");
      if (
        value.recovery.kind !== "caddy_switch_unknown"
        || (value.recovery.expectedActiveSlot !== null && !config.slotIds.includes(value.recovery.expectedActiveSlot))
        || !config.slotIds.includes(value.recovery.targetSlot)
        || value.recovery.expectedActiveSlot === value.recovery.targetSlot
        || !Number.isSafeInteger(value.recovery.expectedGeneration)
        || value.recovery.expectedGeneration < 0
      ) fail("state_invalid", "release recovery marker is malformed");
    }
  }
  exactKeys(value.slots, config.slotIds, "release state slots", "state_invalid");
  const slots = {};
  for (const slot of config.slotIds) {
    const record = value.slots[slot];
    exactKeys(record, ["artifact", "seal", "state"], `release state slot ${slot}`, "state_invalid");
    if (!["empty", "prepared", "running", "active"].includes(record.state)) fail("state_invalid", "slot state is invalid");
    if ((record.state === "empty") !== (record.artifact === null && record.seal === null)) fail("state_invalid", "empty slot identity is inconsistent");
    if (record.state !== "empty" && (record.artifact === null || record.seal === null)) fail("state_invalid", "non-empty slot seal identity is missing");
    slots[slot] = {
      state: record.state,
      artifact: record.artifact === null ? null : validateArtifact(record.artifact, `slot ${slot} artifact`),
      seal: record.seal === null ? null : validateSealIdentity(record.seal, `slot ${slot} seal`),
    };
  }
  if (value.activeSlot !== null && slots[value.activeSlot].state !== "active") fail("state_invalid", "active slot state is inconsistent");
  return { ...value, slots };
}

async function readJson(target, label) {
  let bytes;
  try {
    bytes = await readFile(target);
  } catch (error) {
    fail("state_invalid", `${label} could not be read`, error);
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail("state_invalid", `${label} is not valid JSON`, error);
  }
}

async function exactHealth(fetchImpl, url, artifact, signal) {
  let response;
  try {
    response = await fetchImpl(url, { method: "GET", redirect: "error", headers: { accept: "application/json" }, signal });
  } catch (error) {
    fail("health_failed", "readiness request failed", error);
  }
  const text = await response.text();
  if (!response.ok || text.length > 4096) return { ok: false, releaseId: null, sourceSha: null };
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, releaseId: null, sourceSha: null };
  }
  const sourceSha = typeof payload?.buildSha === "string" && SHA40.test(payload.buildSha)
    ? payload.buildSha
    : null;
  const releaseSha = typeof payload?.releaseSha === "string" && SHA40.test(payload.releaseSha)
    ? payload.releaseSha
    : null;
  const releaseId = typeof payload?.artifactSha256 === "string" && SHA64.test(payload.artifactSha256)
    ? payload.artifactSha256
    : null;
  const serverActionsKeyFingerprint = typeof payload?.serverActionsKeyFingerprint === "string"
    && SHA64.test(payload.serverActionsKeyFingerprint)
    ? payload.serverActionsKeyFingerprint
    : null;
  const ok = payload?.service === "moawork-web"
    && payload.status === "ready"
    && payload.runtime === "self-hosted"
    && payload.revision === "verified"
    && payload.artifact === "verified"
    && payload.serverActions === "verified"
    && sourceSha === artifact.sourceSha
    && releaseSha === artifact.sourceSha
    && releaseId === artifact.releaseId
    && serverActionsKeyFingerprint !== null;
  return { ok, releaseId, sourceSha, serverActionsKeyFingerprint };
}

function upstreamBytes(port) {
  return Buffer.from(`reverse_proxy 127.0.0.1:${port}\n`, "utf8");
}

async function boundedAbortOperation(timeoutMs, label, operation) {
  const controller = new AbortController();
  const terminationHandlers = [];
  let settled = false;
  let timeout;
  const work = Promise.resolve()
    .then(() => operation(controller.signal, (handler) => {
      if (typeof handler !== "function") fail("command_failed", `${label} registered an invalid termination handler`);
      terminationHandlers.push(handler);
    }))
    .finally(() => { settled = true; });
  const limit = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      const error = new LinuxReleaseRuntimeError("timeout", `${label} exceeded its bounded timeout`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, limit]);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    const forced = [];
    let forcedSettled = false;
    const forceWork = Promise.allSettled(terminationHandlers.map((handler) => Promise.resolve().then(handler)))
      .then((results) => {
        forced.push(...results);
        forcedSettled = true;
      });
    const hardDeadlineMs = Math.min(1_000, Math.max(100, timeoutMs));
    await Promise.race([
      Promise.allSettled([work, forceWork]),
      new Promise((resolve) => setTimeout(resolve, hardDeadlineMs)),
    ]);
    const terminationProven = settled && (
      terminationHandlers.length === 0
      || (forcedSettled && forced.every((result) => result.status === "fulfilled" && result.value === true))
    );
    const timeoutError = new LinuxReleaseRuntimeError("timeout", terminationProven
      ? `${label} timed out after proven command termination`
      : `${label} termination could not be proven before the hard deadline`, error);
    timeoutError.terminationProven = terminationProven;
    throw timeoutError;
  } finally {
    clearTimeout(timeout);
  }
}

async function boundedCleanup(timeoutMs, operation) {
  return boundedAbortOperation(timeoutMs, "compensating Caddy recovery", operation);
}

export async function createLinuxReleaseRuntime(input, dependencies = {}) {
  const config = normalizeConfig(input);
  const validatedArtifact = (artifact, label = "artifact") => {
    const value = validateArtifact(artifact, label);
    if (value.builder.arch !== config.nodeArch || value.builder.nodeVersion !== config.nodeVersion) {
      fail("artifact_invalid", `${label} builder identity differs from the audited target runtime`);
    }
    return value;
  };
  const commandRunner = dependencies.commandRunner ?? defaultCommandRunner;
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const materializeArtifact = dependencies.materializeArtifact ?? defaultMaterializeArtifact;
  const beforeAtomicWrite = dependencies.beforeAtomicWrite ?? (() => {});
  const resolveServiceIdentity = dependencies.resolveServiceIdentity ?? defaultResolveServiceIdentity;
  const rawReleaseFileSystem = {
    chmod,
    chown,
    lstat,
    readdir,
    rename,
    rm,
    stat,
    ...(dependencies.releaseFileSystem ?? {}),
  };
  if (typeof commandRunner !== "function" || typeof fetchImpl !== "function" || typeof materializeArtifact !== "function" || typeof beforeAtomicWrite !== "function" || typeof resolveServiceIdentity !== "function") fail("invalid_config", "runtime dependencies are unavailable");
  for (const operation of ["chmod", "chown", "lstat", "readdir", "rename", "rm", "stat"]) {
    if (typeof rawReleaseFileSystem[operation] !== "function") fail("invalid_config", "release filesystem dependencies are unavailable");
  }
  const suppliedDeployIdentity = dependencies.deployIdentity;
  const deployIdentity = suppliedDeployIdentity !== undefined
    ? Object.freeze({ uid: BigInt(suppliedDeployIdentity.uid), gid: BigInt(suppliedDeployIdentity.gid), user: suppliedDeployIdentity.user ?? "test-deploy" })
    : process.platform === "linux"
      ? Object.freeze({ uid: BigInt(process.getuid()), gid: BigInt(process.getgid()), user: os.userInfo().username })
      : null;
  let serviceIdentity = null;
  if (deployIdentity !== null) {
    const resolved = await resolveServiceIdentity({ user: config.serviceUser });
    if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) fail("host_contract", "service identity is unavailable");
    for (const key of ["uid", "gid"]) {
      const value = resolved[key];
      if ((typeof value !== "bigint" && !Number.isSafeInteger(value)) || BigInt(value) < 0n) fail("host_contract", `service ${key} is malformed`);
    }
    if (!Array.isArray(resolved.groups) || resolved.groups.length === 0) fail("host_contract", "service supplementary group set is unavailable");
    const groups = [...new Set(resolved.groups.map((value) => {
      if ((typeof value !== "bigint" && !Number.isSafeInteger(value)) || BigInt(value) < 0n) fail("host_contract", "service supplementary group is malformed");
      return BigInt(value);
    }))];
    serviceIdentity = Object.freeze({ uid: BigInt(resolved.uid), gid: BigInt(resolved.gid), groups: Object.freeze(groups) });
    if (!serviceIdentity.groups.includes(serviceIdentity.gid)) fail("host_contract", "service primary gid is absent from its exact group set");
    if (serviceIdentity.uid === deployIdentity.uid) fail("host_contract", "deploy and service identities must be distinct");
  }
  let lock = null;
  const pendingOperations = new Set();
  const operationLeaseStorage = new AsyncLocalStorage();

  function requireMutationLease() {
    const lease = operationLeaseStorage.getStore();
    if (lease === null || lease === undefined || lease.revoked || lock?.lease !== lease) {
      fail("recovery_required", "the release operation lease no longer permits namespace mutation");
    }
  }

  const releaseFileSystem = {
    lstat: rawReleaseFileSystem.lstat,
    readdir: rawReleaseFileSystem.readdir,
    stat: rawReleaseFileSystem.stat,
    chmod: (...args) => {
      requireMutationLease();
      return rawReleaseFileSystem.chmod(...args);
    },
    chown: (...args) => {
      requireMutationLease();
      return rawReleaseFileSystem.chown(...args);
    },
    rename: (...args) => {
      requireMutationLease();
      return rawReleaseFileSystem.rename(...args);
    },
    rm: (...args) => {
      requireMutationLease();
      return rawReleaseFileSystem.rm(...args);
    },
  };

  function namespaceMkdir(...args) {
    requireMutationLease();
    return mkdir(...args);
  }

  function namespaceUnlink(...args) {
    requireMutationLease();
    return unlink(...args);
  }

  function serviceHasMode(stats, ownerMask, groupMask, otherMask) {
    if (serviceIdentity === null) return true;
    if (stats.uid === serviceIdentity.uid) return (stats.mode & ownerMask) === ownerMask;
    if (serviceIdentity.groups.includes(stats.gid)) return (stats.mode & groupMask) === groupMask;
    return (stats.mode & otherMask) === otherMask;
  }

  function assertProtectedNamespace(inspection, label) {
    if (deployIdentity === null) return;
    const strictFrom = Math.max(0, inspection.components.length - (inspection.exists ? 2 : 1));
    for (let index = 0; index < inspection.components.length; index += 1) {
      const component = inspection.components[index];
      const { stats } = component;
      if (stats.uid !== 0n && stats.uid !== deployIdentity.uid) {
        fail("host_contract", `${label} namespace has an untrusted owner`);
      }
      if (stats.uid === serviceIdentity.uid) fail("host_contract", `${label} namespace is owned by the service identity`);
      // A sticky shared ancestor such as /tmp is safe only above the trusted
      // mutable parent. The target and its immediate parent must never rely on
      // sticky-bit ownership to prevent service/unrelated namespace replacement.
      const stickyNamespace = index < strictFrom && stats.isDirectory() && (stats.mode & 0o1000n) !== 0n;
      const sharedWrite = (stats.mode & 0o022n) !== 0n;
      if ((sharedWrite && !stickyNamespace) || (serviceHasMode(stats, 0o200n, 0o020n, 0o002n) && !stickyNamespace)) {
        fail("host_contract", `${label} namespace is writable by the service or an unrelated identity`);
      }
    }
  }

  async function inspectHostPath(target, label, options = {}) {
    const inspection = await inspectPhysicalPath(target, label, { ...options, lstatImpl: releaseFileSystem.lstat });
    assertProtectedNamespace(inspection, label);
    return inspection;
  }

  async function assertServicePathAccess(target, label, { finalFile = false } = {}) {
    if (serviceIdentity === null) return;
    const root = path.parse(target).root;
    const segments = path.relative(root, target).split(path.sep).filter(Boolean);
    const components = [root];
    for (const segment of segments) components.push(path.join(components.at(-1), segment));
    for (let index = 0; index < components.length; index += 1) {
      const current = components[index];
      let entry;
      try {
        entry = await releaseFileSystem.lstat(current, { bigint: true });
      } catch (error) {
        if (error?.code === "ENOENT") return;
        fail("host_contract", `${label} service access path is unavailable`, error);
      }
      if (entry.isSymbolicLink()) fail("host_contract", `${label} service access must not traverse a symlink or junction`);
      const isFinal = index === components.length - 1;
      if (!isFinal || !finalFile) {
        if (!entry.isDirectory() || !serviceHasMode(entry, 0o100n, 0o010n, 0o001n)) {
          fail("host_contract", `${label} is not traversable by the exact service identity`);
        }
      } else if (!entry.isFile() || !serviceHasMode(entry, 0o500n, 0o050n, 0o005n)) {
        fail("host_contract", `${label} is not readable and executable by the exact service identity`);
      }
    }
  }

  async function inspectReleaseEntry(target, label) {
    const before = await releaseFileSystem.lstat(target, { bigint: true }).catch((error) => fail("host_contract", `${label} cannot be inspected`, error));
    const followed = await releaseFileSystem.stat(target, { bigint: true }).catch((error) => fail("host_contract", `${label} cannot be followed`, error));
    if (before.isSymbolicLink() || (!before.isFile() && !before.isDirectory()) || !samePhysicalEntry(before, followed)) {
      fail("host_contract", `${label} changed identity or is not a regular release entry`);
    }
    if (before.isFile() && before.nlink !== 1n) fail("host_contract", `${label} must not have hardlink aliases`);
    return before;
  }

  async function walkSealedRelease(root, { seal }) {
    const entries = [];
    const physicalFiles = new Map();
    async function visit(target, relativePath) {
      const label = relativePath === "." ? "release root" : `release entry ${relativePath}`;
      const before = await inspectReleaseEntry(target, label);
      if (before.isFile()) {
        const identity = physicalIdentity(before);
        if (physicalFiles.has(identity)) fail("host_contract", `${label} hardlinks another release file`);
        physicalFiles.set(identity, relativePath);
      }
      if (seal) {
        if (deployIdentity !== null) {
          await releaseFileSystem.chown(target, Number(deployIdentity.uid), Number(serviceIdentity.gid))
            .catch((error) => fail("host_contract", `${label} ownership could not be sealed`, error));
        }
        await releaseFileSystem.chmod(target, before.isDirectory() ? 0o550 : 0o440)
          .catch((error) => fail("host_contract", `${label} mode could not be sealed`, error));
      }
      const after = await inspectReleaseEntry(target, label);
      if (after.dev !== before.dev || after.ino !== before.ino || after.isDirectory() !== before.isDirectory()) {
        fail("host_contract", `${label} changed identity while sealing`);
      }
      if (process.platform === "linux") {
        const expectedMode = after.isDirectory() ? 0o550n : 0o440n;
        if ((after.mode & 0o777n) !== expectedMode) fail("host_contract", `${label} has an unsafe installed mode`);
        if (after.uid !== deployIdentity.uid || after.gid !== serviceIdentity.gid) fail("host_contract", `${label} is not deploy-owned for the service primary group`);
      }
      entries.push(releaseEntrySnapshot(relativePath, after));
      if (after.isDirectory()) {
        const names = await releaseFileSystem.readdir(target).catch((error) => fail("host_contract", `${label} cannot be enumerated`, error));
        if (!Array.isArray(names) || names.some((name) => typeof name !== "string" || name.length === 0 || name === "." || name === ".." || path.basename(name) !== name)) {
          fail("host_contract", `${label} returned an unsafe directory entry`);
        }
        for (const name of [...names].sort()) await visit(path.join(target, name), relativePath === "." ? name : path.join(relativePath, name));
      }
    }
    await visit(root, ".");
    return entries;
  }

  async function sealRelease(root) {
    return sealIdentity(await walkSealedRelease(root, { seal: true }));
  }

  async function verifySealedRelease(slot, seal) {
    const expected = validateSealIdentity(seal, `slot ${slot} seal`);
    const target = config.slots[slot].releaseDir;
    const actual = sealIdentity(await walkSealedRelease(target, { seal: false }));
    if (actual.digest !== expected.digest) fail("host_contract", `slot ${slot} release identity drifted after installation`);
    return actual;
  }

  async function makeReleaseTreeDeletable(root) {
    if (!await pathExists(root)) return;
    // Linux release names are mutable only by the deploy owner: releaseRoot is 0750 and
    // every installed directory is 0550. The service group and unrelated identities have
    // no directory write bit, so the immediate lstat/stat/nlink check below closes the
    // remaining static/late-hardlink boundary before each path-based chmod.
    async function visit(target, relativePath) {
      const label = relativePath === "." ? "release cleanup root" : `release cleanup entry ${relativePath}`;
      const entry = await inspectReleaseEntry(target, label);
      if (entry.isDirectory()) {
        // The exact entry is checked again immediately before chmod. Directory
        // replacement is outside the service/unrelated threat model because the
        // parent is deploy-owned and has no group/other write bit.
        await inspectReleaseEntry(target, label);
        await releaseFileSystem.chmod(target, 0o700).catch((error) => fail("host_contract", `${label} could not be opened for cleanup`, error));
        const names = await releaseFileSystem.readdir(target).catch((error) => fail("host_contract", `${label} cannot be enumerated for cleanup`, error));
        for (const name of [...names].sort()) await visit(path.join(target, name), relativePath === "." ? name : path.join(relativePath, name));
      } else {
        // Re-lstat/stat/nlink at the last possible path boundary. In particular,
        // a late external hardlink is rejected before its shared inode is chmodded.
        await inspectReleaseEntry(target, label);
        await releaseFileSystem.chmod(target, 0o600).catch((error) => fail("host_contract", `${label} could not be opened for cleanup`, error));
      }
    }
    await visit(root, ".");
  }

  async function removeReleaseTree(root) {
    if (!await pathExists(root)) return;
    await makeReleaseTreeDeletable(root);
    await releaseFileSystem.rm(root, { recursive: true, force: true });
  }

  async function assertHostContract() {
    const releaseInspection = await inspectHostPath(config.releaseRoot, "releaseRoot");
    await assertDirectory(config.releaseRoot, "releaseRoot", { writable: true });
    if (deployIdentity !== null) {
      if (
        releaseInspection.stats.uid !== deployIdentity.uid
        || releaseInspection.stats.gid !== serviceIdentity.gid
        || (releaseInspection.stats.mode & 0o777n) !== 0o750n
      ) fail("host_contract", "releaseRoot must be deploy-owned for the service primary group with mode 0750");
    }
    await assertServicePathAccess(config.releaseRoot, "releaseRoot");
    for (const slot of config.slotIds) {
      await assertServicePathAccess(path.join(config.slots[slot].releaseDir, "runtime", "app"), `slot ${slot} WorkingDirectory`);
    }
    const parentEntries = [
      [path.dirname(config.stateFile), "state directory"],
      [path.dirname(config.lockFile), "lock directory"],
      [path.dirname(config.upstreamFile), "upstream directory"],
    ];
    const directoryIdentities = new Map();
    recordPhysicalAlias(directoryIdentities, config.releaseRoot, releaseInspection.stats, "releaseRoot");
    for (const [target, label] of parentEntries) {
      const inspection = await inspectHostPath(target, label);
      await assertDirectory(target, label, { writable: true });
      recordPhysicalAlias(directoryIdentities, target, inspection.stats, label);
      if (inspection.realPath === releaseInspection.realPath || physicallyInside(releaseInspection.realPath, inspection.realPath)) {
        fail("host_contract", `${label} must be physically outside releaseRoot`);
      }
    }
    for (const slot of config.slotIds) {
      const target = config.slots[slot].releaseDir;
      const inspection = await inspectHostPath(target, `slot ${slot} release`, { allowMissingFinal: true });
      const physicalTarget = inspection.realPath ?? path.join(inspection.parentRealPath, path.basename(target));
      if (!physicallyInside(releaseInspection.realPath, physicalTarget)) fail("host_contract", `slot ${slot} release must be physically inside releaseRoot`);
      if (inspection.exists && !inspection.stats.isDirectory()) fail("host_contract", `slot ${slot} release must be a real directory`);
    }
    const regularInputs = await Promise.all([
      [config.runtimeEnvFile, "runtime env", { privateFile: true }],
      [config.caddyConfigFile, "Caddy root config"],
      [config.caddySiteFile, "Caddy managed site"],
      [config.systemctlPath, "systemctl executable"],
      [config.caddyPath, "caddy executable"],
      [config.nodePath, "Node executable"],
      [config.trustedBuilderPublicKeyPath, "trusted builder public key"],
    ].map(async ([target, label, options]) => {
      const inspection = await inspectHostPath(target, label);
      const stats = await assertRegular(target, label, options);
      if (label === "Node executable") await assertServicePathAccess(target, label, { finalFile: true });
      if (inspection.realPath === releaseInspection.realPath || physicallyInside(releaseInspection.realPath, inspection.realPath)) {
        fail("host_contract", `${label} must be physically outside releaseRoot`);
      }
      return { label, realPath: inspection.realPath, stats, target };
    }));
    const mutableOutputs = [];
    for (const [target, label] of [
      [config.stateFile, "release state"],
      [config.lockFile, "deploy lock"],
      [config.upstreamFile, "Caddy upstream"],
    ]) {
      const inspection = await inspectHostPath(target, label, { allowMissingFinal: true });
      if (!inspection.exists) continue;
      if (!inspection.stats.isFile()) fail("host_contract", `${label} must be a regular non-link file when present`);
      mutableOutputs.push({ label, realPath: inspection.realPath, stats: inspection.stats, target });
    }
    const physicalFiles = new Map();
    for (const entry of [...regularInputs, ...mutableOutputs]) {
      recordPhysicalAlias(physicalFiles, entry.target, entry.stats, entry.label);
    }
    const [caddyRoot, caddySite] = await Promise.all([
      readFile(config.caddyConfigFile),
      readFile(config.caddySiteFile),
    ]);
    const rootLines = caddyRoot.toString("utf8").split(/\r?\n/u);
    if (rootLines.filter((line) => line === config.caddyImportLine).length !== 1) fail("host_contract", "Caddy root does not bind exactly one reviewed managed-site import");
    if (sha256(caddySite) !== config.caddySiteSha256) fail("host_contract", "Caddy managed site differs from the reviewed digest");
    const upstreamImport = `import ${path.dirname(config.upstreamFile)}${path.sep}*.caddy`;
    if (caddySite.toString("utf8").split(/\r?\n/u).filter((line) => line.trim() === upstreamImport).length !== 1) {
      fail("host_contract", "Caddy managed site does not bind exactly one reviewed upstream import");
    }
    if (sha256(Buffer.from(`${config.caddyImportLine}\0${caddySite.toString("utf8")}`, "utf8")) !== config.caddyClosureSha256) {
      fail("host_contract", "Caddy managed closure differs from the reviewed digest");
    }
  }

  async function assertArtifactNamespace(artifact) {
    const identities = new Map();
    for (const [target, label] of [
      [artifact.archivePath, "release artifact archive"],
      [artifact.manifestPath, "release artifact manifest"],
    ]) {
      const inspection = await inspectHostPath(target, label);
      if (!inspection.stats.isFile()) fail("host_contract", `${label} must be a regular non-link file`);
      recordPhysicalAlias(identities, target, inspection.stats, label);
    }
  }

  function requireLock() {
    const lease = operationLeaseStorage.getStore();
    if (lock === null || lease === null || lease === undefined || lock.lease !== lease) fail("lock_required", "the complete release operation requires the exclusive deploy lock");
    if (lease.revoked || lock.allowMutation === false) fail("recovery_required", "the release lock is retained for operator reconciliation");
  }

  async function retainRecoveryLock(kind) {
    lock.retain = true;
    lock.allowMutation = false;
    lock.lease.revoked = true;
    try {
      const recoveryLock = Buffer.from(`${JSON.stringify({ schema: 1, state: "recovery_required", kind, pid: process.pid })}\n`);
      await lock.handle.write(recoveryLock, 0, recoveryLock.length, 0);
      await lock.handle.truncate(recoveryLock.length);
      await lock.handle.sync();
    } catch {
      // The existing exclusive inode remains the fail-closed recovery marker.
    }
  }

  function tracked(operation) {
    const lease = lock?.lease ?? null;
    const pending = operationLeaseStorage.run(lease, () => Promise.resolve().then(operation));
    pendingOperations.add(pending);
    pending.then(
      () => pendingOperations.delete(pending),
      () => pendingOperations.delete(pending),
    );
    return pending;
  }

  async function readState() {
    requireLock();
    const value = await pathExists(config.stateFile) ? await readJson(config.stateFile, "release state") : emptyStatus(config);
    const state = validateState(value, config);
    if (state.recovery !== null) fail("recovery_required", "a prior release outcome requires operator reconciliation");
    for (const slot of config.slotIds) {
      const record = state.slots[slot];
      if (record.artifact !== null) validatedArtifact(record.artifact, `slot ${slot} artifact`);
      const releaseDir = config.slots[slot].releaseDir;
      if (record.artifact === null) {
        if (await pathExists(releaseDir)) fail("state_invalid", `empty slot ${slot} has an untracked release directory`);
        continue;
      }
      await assertDirectory(releaseDir, `slot ${slot} release`);
      const stored = validatedArtifact(await readJson(path.join(releaseDir, ARTIFACT_STATE_NAME), `slot ${slot} identity`));
      if (!identitiesEqual(stored, record.artifact)) fail("state_invalid", `slot ${slot} filesystem identity differs from state`);
      await verifySealedRelease(slot, record.seal);
    }
    const upstreamExists = await pathExists(config.upstreamFile);
    if (state.activeSlot === null) {
      if (upstreamExists) fail("state_invalid", "an upstream exists without an active MoaWork slot");
    } else {
      if (!upstreamExists) fail("state_invalid", "active MoaWork slot is missing its upstream");
      await assertRegular(config.upstreamFile, "Caddy upstream");
      const expected = upstreamBytes(config.slots[state.activeSlot].port);
      if (!(await readFile(config.upstreamFile)).equals(expected)) fail("state_invalid", "Caddy upstream differs from active state");
    }
    return state;
  }

  async function writeState(state) {
    await writeAtomic(config.stateFile, Buffer.from(canonicalJson(validateState(state, config))), 0o600);
  }

  async function writeAtomic(target, bytes, mode) {
    requireMutationLease();
    await beforeAtomicWrite({ target, bytes: Buffer.from(bytes), mode });
    requireMutationLease();
    return atomicWrite(target, bytes, mode, requireMutationLease);
  }

  async function run(file, args, callerSignal) {
    return boundedAbortOperation(config.timeoutMs, `${path.basename(file)} command`, (freshSignal, registerTermination) => commandRunner({
      file,
      args: [...args],
      signal: callerSignal ? AbortSignal.any([callerSignal, freshSignal]) : freshSignal,
      registerTermination,
    }));
  }

  async function runBoundedServiceCommand(slot, verb, callerSignal) {
    return run(config.systemctlPath, [verb, config.slots[slot].unit], callerSignal);
  }

  async function queryServiceActive(slot) {
    const result = await run(config.systemctlPath, [
      "show",
      config.slots[slot].unit,
      "--no-pager",
      "--property=ActiveState",
      "--value",
    ]);
    if (result?.stderr !== "" || !["active\n", "inactive\n"].includes(result?.stdout)) {
      fail("service_state_unknown", "systemd returned an inexact ActiveState result");
    }
    return result.stdout === "active\n";
  }

  async function persistUnknownService(before, { slot, operation, expectedActive }, cause) {
    lock.retain = true;
    const recovery = { kind: "service_state_unknown", slot, operation, expectedActive };
    try {
      await writeState({ ...before, recovery });
    } catch (stateError) {
      try {
        const recoveryLock = Buffer.from(`${JSON.stringify({ schema: 1, state: "recovery_required", kind: recovery.kind, slot, operation, pid: process.pid })}\n`);
        await lock.handle.write(recoveryLock, 0, recoveryLock.length, 0);
        await lock.handle.truncate(recoveryLock.length);
        await lock.handle.sync();
      } catch {
        // The already-created exclusive lock entry is itself the final fail-closed marker.
      }
      fail("service_state_unknown", "service outcome is unknown and the exclusive recovery lock was retained", new AggregateError([cause, stateError]));
    }
    lock.allowMutation = false;
    lock.lease.revoked = true;
    fail("service_state_unknown", "service outcome requires operator reconciliation", cause);
  }

  async function persistUnknownCleanup(before, slot, cause) {
    lock.retain = true;
    try {
      await writeState({ ...before, recovery: { kind: "release_cleanup_unknown", slot, operation: "reject" } });
    } catch {
      // The retained exact lock is the recovery record if state persistence cannot
      // itself be proven after a partial filesystem cleanup.
    }
    lock.allowMutation = false;
    lock.lease.revoked = true;
    fail("cleanup_failed", "release cleanup outcome requires operator reconciliation", cause);
  }

  function hasUnprovenTermination(error) {
    return error instanceof LinuxReleaseRuntimeError && error.code === "timeout" && error.terminationProven === false;
  }

  async function requireServiceState(before, slot, expectedActive, operation, cause) {
    let actual;
    try {
      actual = await queryServiceActive(slot);
    } catch (queryError) {
      await persistUnknownService(before, { slot, operation, expectedActive }, new AggregateError([cause, queryError]));
    }
    if (actual !== expectedActive) {
      await persistUnknownService(before, { slot, operation, expectedActive }, cause);
    }
  }

  async function compensateServiceTransition(before, slot, verb, expectedActive, operation) {
    let transitionError = null;
    try {
      // The attempt exists before awaiting the command. Any thrown/aborted result is
      // reconciled independently below with a fresh bounded signal.
      await run(config.systemctlPath, [verb, config.slots[slot].unit]);
    } catch (error) {
      transitionError = error;
    }
    if (hasUnprovenTermination(transitionError)) {
      await persistUnknownService(before, { slot, operation, expectedActive }, transitionError);
    }
    await requireServiceState(before, slot, expectedActive, operation, transitionError ?? new Error(`${verb} state verification failed`));
  }

  async function assertUnitContract(slot, signal) {
    const slotConfig = config.slots[slot];
    let result;
    try {
      result = await run(config.systemctlPath, [
        "show",
        slotConfig.unit,
        "--no-pager",
        `--property=${SYSTEMD_PROPERTIES.join(",")}`,
      ], signal);
    } catch (error) {
      if (hasUnprovenTermination(error)) await retainRecoveryLock("unit_contract_command_unknown");
      throw error;
    }
    const properties = parseSystemdProperties(result?.stdout);
    const workingDirectory = path.join(slotConfig.releaseDir, "runtime", "app");
    const identityEnv = path.join(slotConfig.releaseDir, RUNTIME_ENV_NAME);
    parseBoundedMicroseconds(properties.get("RestartUSec"), "RestartUSec", 1_000n, 300_000_000n);
    parseBoundedInteger(properties.get("MemoryMax"), "MemoryMax", 16n * 1024n * 1024n, 8n * 1024n * 1024n * 1024n);
    parseBoundedInteger(properties.get("TasksMax"), "TasksMax", 8n, 4096n);
    parseBoundedMicroseconds(properties.get("CPUQuotaPerSecUSec"), "CPUQuotaPerSecUSec", 10_000n, 8_000_000n);
    if (
      properties.get("LoadState") !== "loaded"
      || properties.get("User") !== config.serviceUser
      || properties.get("Group") !== ""
      || properties.get("WorkingDirectory") !== workingDirectory
      || properties.get("EnvironmentFiles") !== `${config.runtimeEnvFile} (ignore_errors=no) ${identityEnv} (ignore_errors=no)`
      || !exactExecStart(properties.get("ExecStart"), config.nodePath)
      || properties.get("Restart") !== "on-failure"
      || properties.get("StandardOutput") !== "journal"
      || properties.get("StandardError") !== "journal"
      || properties.get("SyslogIdentifier") !== slotConfig.unit.replace(/[.]service$/u, "")
      || properties.get("NoNewPrivileges") !== "yes"
      || properties.get("PrivateTmp") !== "yes"
      || properties.get("ProtectSystem") !== "strict"
      || properties.get("ProtectHome") !== "yes"
      || properties.get("ReadWritePaths") !== config.releaseRoot
    ) fail("host_contract", `systemd unit ${slotConfig.unit} differs from the reviewed runtime contract`);
  }

  async function withExclusiveLock(operation) {
    if (typeof operation !== "function") fail("invalid_input", "lock operation is required");
    if (lock !== null) fail("lock_busy", "nested release locks are forbidden");
    await assertHostContract();
    let handle;
    try {
      handle = await open(config.lockFile, "wx", 0o600);
    } catch (error) {
      if (error?.code === "EEXIST") fail("lock_busy", "another release operation owns the deploy lock");
      fail("host_contract", "deploy lock could not be acquired", error);
    }
    const identity = await handle.stat({ bigint: true });
    const lease = { revoked: false };
    lock = { handle, identity, lease, retain: false, allowMutation: true };
    try {
      await handle.writeFile(`${JSON.stringify({ pid: process.pid })}\n`);
      await handle.sync();
      return await operation();
    } finally {
      let pendingError = null;
      if (pendingOperations.size > 0) {
        const settled = await Promise.race([
          Promise.allSettled([...pendingOperations]).then(() => true),
          new Promise((resolve) => setTimeout(() => resolve(false), Math.min(1_000, Math.max(100, config.timeoutMs)))),
        ]);
        if (!settled) {
          lease.revoked = true;
          await retainRecoveryLock("pending_operation_timeout");
          pendingError = new LinuxReleaseRuntimeError("timeout", "pending release work did not terminate before the hard deadline");
        }
      }
      const completedLock = lock;
      lease.revoked = true;
      lock = null;
      await handle.close();
      const current = await stat(config.lockFile, { bigint: true }).catch(() => null);
      if (!completedLock.retain && current && current.dev === identity.dev && current.ino === identity.ino) await unlink(config.lockFile);
      if (pendingError !== null) throw pendingError;
    }
  }

  async function status() {
    return structuredClone(await readState());
  }

  async function prepare({ slot, artifact, signal }) {
    requireLock();
    const expected = validatedArtifact(artifact);
    await assertArtifactNamespace(expected);
    const before = await readState();
    if (!config.slotIds.includes(slot) || slot === before.activeSlot) fail("prepare_rejected", "only the inactive configured slot may be prepared");
    const target = config.slots[slot].releaseDir;
    const materializeRoot = path.join(config.releaseRoot, `.${slot}.materialize-${randomUUID()}`);
    const staging = path.join(materializeRoot, "release");
    const backup = path.join(config.releaseRoot, `.${slot}.previous-${randomUUID()}`);
    let movedOld = false;
    let installed = false;
    let unitStopped = false;
    let stopAttempted = false;
    let stateCommitted = false;
    try {
      await assertUnitContract(slot, signal);
      await namespaceMkdir(materializeRoot, { recursive: false, mode: 0o700 });
      const extracted = await boundedAbortOperation(config.timeoutMs, "artifact materialization", (freshSignal, registerTermination) => materializeArtifact({
        artifact: expected,
        destinationPath: staging,
        signal: signal ? AbortSignal.any([signal, freshSignal]) : freshSignal,
        registerTermination,
      }));
      if (signal?.aborted) fail("artifact_materialize_failed", "artifact materialization was aborted");
      if (!identitiesEqual(extracted, expected)) fail("prepare_mismatch", "extracted artifact differs from the verified descriptor");
      await assertRegular(path.join(staging, "runtime", "app", "server.js"), "standalone server entry");
      await writeAtomic(path.join(staging, ARTIFACT_STATE_NAME), Buffer.from(canonicalJson(expected)), 0o600);
      await writeAtomic(path.join(staging, RUNTIME_ENV_NAME), Buffer.from(
        `HOSTNAME=127.0.0.1\nPORT=${config.slots[slot].port}\nMOAWORK_BUILD_SHA=${expected.sourceSha}\nMOAWORK_RELEASE_SHA=${expected.sourceSha}\nMOAWORK_ARTIFACT_SHA256=${expected.releaseId}\n`,
      ), 0o600);
      const sealed = await sealRelease(staging);
      try {
        stopAttempted = true;
        await runBoundedServiceCommand(slot, "stop", signal);
        unitStopped = true;
      } catch (stopError) {
        if (!stopAttempted) throw stopError;
        if (hasUnprovenTermination(stopError)) await persistUnknownService(before, { slot, operation: "stop", expectedActive: false }, stopError);
        let active;
        try {
          active = await queryServiceActive(slot);
        } catch (queryError) {
          await persistUnknownService(before, { slot, operation: "stop", expectedActive: false }, new AggregateError([stopError, queryError]));
        }
        if (!active) unitStopped = true;
        else if (before.slots[slot].state !== "running") {
          await persistUnknownService(before, { slot, operation: "stop", expectedActive: false }, stopError);
        }
        throw stopError;
      }
      if (await pathExists(target)) {
        await assertDirectory(target, `slot ${slot} previous release`);
        await releaseFileSystem.rename(target, backup);
        movedOld = true;
      }
      await releaseFileSystem.rename(staging, target);
      installed = true;
      await releaseFileSystem.rm(materializeRoot, { recursive: true, force: true });
      await verifySealedRelease(slot, sealed);
      const next = structuredClone(before);
      next.slots[slot] = { state: "prepared", artifact: expected, seal: sealed };
      await writeState(next);
      stateCommitted = true;
      if (movedOld) {
        try {
          await removeReleaseTree(backup);
        } catch (error) {
          fail("cleanup_failed", "release state committed but the prior release backup could not be removed", error);
        }
      }
      return { slot, artifact: structuredClone(expected) };
    } catch (error) {
      if (hasUnprovenTermination(error)) {
        await retainRecoveryLock("artifact_materialization_unknown");
        throw error;
      }
      if (stateCommitted) {
        lock.retain = true;
        throw error;
      }
      try {
        if (installed) await removeReleaseTree(target);
        if (movedOld) {
          await releaseFileSystem.rename(backup, target);
          await verifySealedRelease(slot, before.slots[slot].seal);
        }
        if (unitStopped && before.slots[slot].state === "running") {
          if (!await pathExists(target)) fail("compensation_failed", "a prior running release was not available for restart");
          await verifySealedRelease(slot, before.slots[slot].seal);
          await compensateServiceTransition(before, slot, "restart", true, "compensating_restart");
        }
        await makeReleaseTreeDeletable(staging);
        if (await pathExists(materializeRoot)) await releaseFileSystem.rm(materializeRoot, { recursive: true, force: true });
      } catch (compensationError) {
        lock.retain = true;
        if (compensationError instanceof LinuxReleaseRuntimeError && compensationError.code === "service_state_unknown") throw compensationError;
        fail("compensation_failed", "release prepare compensation did not restore the exact prior slot", compensationError);
      }
      throw error;
    }
  }

  async function verifyPrepared({ slot, artifact }) {
    requireLock();
    const expected = validatedArtifact(artifact);
    const state = await readState();
    if (!config.slotIds.includes(slot) || !identitiesEqual(state.slots[slot].artifact, expected)) fail("prepare_mismatch", "prepared state identity differs");
    await verifySealedRelease(slot, state.slots[slot].seal);
    await assertRegular(path.join(config.slots[slot].releaseDir, "runtime", "app", "server.js"), "prepared standalone server entry");
    return { slot, artifact: structuredClone(state.slots[slot].artifact) };
  }

  async function startCandidate({ slot, artifact, signal }) {
    requireLock();
    const expected = validatedArtifact(artifact);
    const before = await readState();
    if (slot === before.activeSlot || !identitiesEqual(before.slots[slot]?.artifact, expected)) fail("candidate_rejected", "candidate identity is not prepared in the inactive slot");
    await verifySealedRelease(slot, before.slots[slot].seal);
    let restarted = false;
    try {
      await runBoundedServiceCommand(slot, "restart", signal);
      restarted = true;
    } catch (restartError) {
      if (hasUnprovenTermination(restartError)) await persistUnknownService(before, { slot, operation: "restart", expectedActive: true }, restartError);
      let active;
      try {
        active = await queryServiceActive(slot);
      } catch (queryError) {
        await persistUnknownService(before, { slot, operation: "restart", expectedActive: true }, new AggregateError([restartError, queryError]));
      }
      if (!active) throw restartError;
      restarted = true;
    }
    try {
      const next = structuredClone(before);
      next.slots[slot].state = "running";
      await writeState(next);
    } catch (stateError) {
      if (restarted) await compensateServiceTransition(before, slot, "stop", false, "compensating_stop");
      throw stateError;
    }
  }

  async function checkCandidate({ slot, artifact, signal }) {
    requireLock();
    const expected = validatedArtifact(artifact);
    const state = await readState();
    if (!identitiesEqual(state.slots[slot]?.artifact, expected)) fail("candidate_rejected", "candidate state identity differs");
    return exactHealth(fetchImpl, `http://127.0.0.1:${config.slots[slot].port}/api/health/ready`, expected, signal);
  }

  async function rejectCandidate({ slot, artifact, signal }) {
    requireLock();
    const expected = validatedArtifact(artifact);
    const before = await readState();
    if (slot === before.activeSlot || !identitiesEqual(before.slots[slot]?.artifact, expected)) fail("candidate_rejected", "only the exact inactive candidate may be rejected");
    try {
      await runBoundedServiceCommand(slot, "stop", signal);
    } catch (stopError) {
      if (hasUnprovenTermination(stopError)) await persistUnknownService(before, { slot, operation: "stop", expectedActive: false }, stopError);
      let active;
      try {
        active = await queryServiceActive(slot);
      } catch (queryError) {
        await persistUnknownService(before, { slot, operation: "stop", expectedActive: false }, new AggregateError([stopError, queryError]));
      }
      if (active) {
        if (before.slots[slot].state !== "running") await persistUnknownService(before, { slot, operation: "stop", expectedActive: false }, stopError);
        throw stopError;
      }
    }
    const target = config.slots[slot].releaseDir;
    if (!inside(config.releaseRoot, target)) fail("candidate_rejected", "candidate path escaped releaseRoot");
    try {
      await removeReleaseTree(target);
      const next = structuredClone(before);
      next.slots[slot] = { state: "empty", artifact: null, seal: null };
      if (next.previousSlot === slot) next.previousSlot = null;
      await writeState(next);
    } catch (cleanupError) {
      if (before.slots[slot].state === "running") {
        if (!await pathExists(target)) await persistUnknownService(before, { slot, operation: "compensating_restart", expectedActive: true }, cleanupError);
        await verifySealedRelease(slot, before.slots[slot].seal).catch(async (sealError) => {
          await persistUnknownService(before, { slot, operation: "compensating_restart", expectedActive: true }, new AggregateError([cleanupError, sealError]));
        });
        await compensateServiceTransition(before, slot, "restart", true, "compensating_restart");
      }
      await persistUnknownCleanup(before, slot, cleanupError);
    }
  }

  async function restoreUpstream(previous) {
    if (previous === null) {
      if (await pathExists(config.upstreamFile)) await namespaceUnlink(config.upstreamFile);
    } else {
      await writeAtomic(config.upstreamFile, previous, 0o644);
    }
  }

  async function persistUnknownCaddy(before, targetSlot, cause) {
    if (hasUnprovenTermination(cause)) lock.retain = true;
    const recovery = {
      kind: "caddy_switch_unknown",
      expectedActiveSlot: before.activeSlot,
      expectedGeneration: before.generation,
      targetSlot,
    };
    try {
      await writeState({ ...before, recovery });
    } catch (stateError) {
      const sentinel = Buffer.from("# moawork recovery required\n");
      try {
        await writeAtomic(config.upstreamFile, sentinel, 0o644);
        if (!(await readFile(config.upstreamFile)).equals(sentinel)) fail("recovery_persistence", "recovery sentinel readback failed");
      } catch (sentinelError) {
        lock.retain = true;
        try {
          const recoveryLock = Buffer.from(`${JSON.stringify({ schema: 1, state: "recovery_required", pid: process.pid })}\n`);
          await lock.handle.write(recoveryLock, 0, recoveryLock.length, 0);
          await lock.handle.truncate(recoveryLock.length);
          await lock.handle.sync();
        } catch {
          // The already-created exclusive lock entry remains the final fail-closed boundary.
        }
        fail("timeout", "Caddy outcome is unknown; the exclusive recovery lock was retained", sentinelError);
      }
      fail("timeout", "Caddy outcome is unknown; the upstream recovery sentinel was installed", stateError);
    }
    lock.allowMutation = false;
    lock.lease.revoked = true;
    fail("timeout", "Caddy outcome requires operator reconciliation", cause);
  }

  async function switchActive({ expectedActiveSlot, expectedGeneration, targetSlot, artifact, signal }) {
    requireLock();
    const expected = validatedArtifact(artifact);
    const before = await readState();
    if (before.activeSlot !== expectedActiveSlot || before.generation !== expectedGeneration) fail("concurrent_switch", "release state changed before the switch");
    if (!config.slotIds.includes(targetSlot) || targetSlot === before.activeSlot || !identitiesEqual(before.slots[targetSlot]?.artifact, expected)) {
      fail("switch_rejected", "switch target is not the exact prepared release");
    }
    await verifySealedRelease(targetSlot, before.slots[targetSlot].seal);
    const previousUpstream = await pathExists(config.upstreamFile) ? await readFile(config.upstreamFile) : null;
    let routeInstalled = false;
    let reloadAttempted = false;
    try {
      await writeAtomic(config.upstreamFile, upstreamBytes(config.slots[targetSlot].port), 0o644);
      routeInstalled = true;
      await run(config.caddyPath, ["validate", "--config", config.caddyConfigFile], signal);
      reloadAttempted = true;
      await run(config.systemctlPath, ["reload", config.caddyUnit], signal);
      const next = structuredClone(before);
      if (before.activeSlot !== null) next.slots[before.activeSlot].state = "running";
      next.slots[targetSlot].state = "active";
      next.activeSlot = targetSlot;
      next.previousSlot = before.activeSlot;
      next.generation += 1;
      await writeState(next);
      return { generation: next.generation, activeSlot: next.activeSlot, previousSlot: next.previousSlot };
    } catch (error) {
      if (routeInstalled) {
        try {
          await restoreUpstream(previousUpstream);
        } catch (restoreError) {
          await persistUnknownCaddy(before, targetSlot, new AggregateError([error, restoreError], "Caddy validation failed and the prior route could not be restored"));
        }
        if (reloadAttempted) {
          const previousArtifact = before.activeSlot === null ? null : before.slots[before.activeSlot].artifact;
          let compensationError = null;
          let restoredHealth = null;
          try {
            await boundedCleanup(config.timeoutMs, async (cleanupSignal, registerTermination) => {
              try {
                await run(config.systemctlPath, ["reload", config.caddyUnit], cleanupSignal);
              } catch (reloadError) {
                compensationError = reloadError;
              }
              if (previousArtifact !== null) {
                restoredHealth = await exactHealth(fetchImpl, config.publicHealthUrl, previousArtifact, cleanupSignal);
              }
            });
          } catch (cleanupError) {
            compensationError = cleanupError;
          }
          if (previousArtifact === null || restoredHealth?.ok !== true) {
            await persistUnknownCaddy(before, targetSlot, compensationError ?? error);
          }
        }
      }
      if (hasUnprovenTermination(error)) await persistUnknownCaddy(before, targetSlot, error);
      throw error;
    }
  }

  async function checkPublic({ artifact, signal }) {
    requireLock();
    return exactHealth(fetchImpl, config.publicHealthUrl, validatedArtifact(artifact), signal);
  }

  return Object.freeze({
    checkCandidate: (input) => tracked(() => checkCandidate(input)),
    checkPublic: (input) => tracked(() => checkPublic(input)),
    config,
    prepare: (input) => tracked(() => prepare(input)),
    rejectCandidate: (input) => tracked(() => rejectCandidate(input)),
    startCandidate: (input) => tracked(() => startCandidate(input)),
    status: (input) => tracked(() => status(input)),
    switchActive: (input) => tracked(() => switchActive(input)),
    verifyPrepared: (input) => tracked(() => verifyPrepared(input)),
    withExclusiveLock,
  });
}
