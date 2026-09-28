import { createHash, createPublicKey } from "node:crypto";
import path from "node:path";

const SHA40 = /^[0-9a-f]{40}$/u;
const SHA64 = /^[0-9a-f]{64}$/u;
const SAFE_ACCOUNT = /^[a-z_][a-z0-9_-]{0,31}$/u;
const SAFE_HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/u;

export const PROVISION_SCHEMA = "moawork-vps-provision-v1";
export const AUDIT_SCHEMA = "moawork-vps-readonly-v2";
export const RUNTIME_NODE_VERSION = "v22.23.2";
export const SERVICE_ACCOUNT = "moawork";
export const DEPLOY_ACCOUNT = "moawork-deploy";
export const RUNTIME_ENVIRONMENT_NAMES = Object.freeze([
  "NEXT_PUBLIC_POSTHOG_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
  "NEXT_TELEMETRY_DISABLED",
]);

const TOP_KEYS = [
  "accounts",
  "auditHostIdentitySha256",
  "auditSha256",
  "bootStrategy",
  "caddy",
  "executables",
  "hostLabels",
  "node",
  "paths",
  "ports",
  "preservedStateSha256",
  "resources",
  "runtimeEnvironment",
  "schema",
  "securityModel",
  "sourceSha",
  "trustedBuilder",
  "units",
];

const PATH_KEYS = [
  "caddyConfigFile",
  "caddyManagedDirectory",
  "caddySiteFile",
  "lockFile",
  "nodePath",
  "polkitRuleFile",
  "provisionLockFile",
  "releaseConfigFile",
  "releaseRoot",
  "runtimeEnvFile",
  "stateFile",
  "trustedBuilderPublicKeyPath",
  "upstreamFile",
];

function fail(code, message) {
  const error = new Error(message);
  error.name = "ProvisionManifestError";
  error.code = code;
  throw error;
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("MANIFEST_SHAPE", `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail("MANIFEST_SHAPE", `${label} keys differ from the reviewed contract`);
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Canonical(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function exactAbsolute(value, label) {
  if (typeof value !== "string" || !path.posix.isAbsolute(value) || path.posix.normalize(value) !== value || /[\u0000-\u001f\s]/u.test(value)) {
    fail("MANIFEST_PATH", `${label} must be one canonical Linux absolute path`);
  }
  if (value === "/" || /(?:^|\/)(?:salespt|hermes)(?:\/|$)/iu.test(value)) fail("MANIFEST_PATH", `${label} is outside the dedicated MoaWork namespace`);
  return value;
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail("MANIFEST_VALUE", `${label} is outside the reviewed bound`);
  return value;
}

function validateAccount(value, expectedName, label) {
  exactKeys(value, ["gid", "home", "name", "passwordLocked", "shell", "supplementaryGids", "uid"], label);
  if (value.name !== expectedName || !SAFE_ACCOUNT.test(value.name) || value.passwordLocked !== true) fail("MANIFEST_ACCOUNT", `${label} identity is invalid`);
  boundedInteger(value.uid, 1, 2 ** 31 - 1, `${label}.uid`);
  boundedInteger(value.gid, 1, 2 ** 31 - 1, `${label}.gid`);
  if (!Array.isArray(value.supplementaryGids) || value.supplementaryGids.some((gid) => !Number.isSafeInteger(gid) || gid < 1)) {
    fail("MANIFEST_ACCOUNT", `${label} supplementary groups are invalid`);
  }
  if (new Set(value.supplementaryGids).size !== value.supplementaryGids.length) fail("MANIFEST_ACCOUNT", `${label} supplementary groups must be unique`);
  if (expectedName === SERVICE_ACCOUNT) {
    if (value.shell !== "/usr/sbin/nologin" || value.home !== "/nonexistent" || value.supplementaryGids.length !== 0) fail("MANIFEST_ACCOUNT", "service account must be nologin with no supplementary groups or home");
  } else if (value.shell !== "/bin/bash" || value.home !== "/home/moawork-deploy") fail("MANIFEST_ACCOUNT", "deploy account shell/home must match the reviewed automation contract");
  return value;
}

function validateRuntimeEnvironment(value) {
  exactKeys(value, ["allowedNames", "owner", "group", "mode"], "runtimeEnvironment");
  if (value.owner !== "root" || value.group !== "root" || value.mode !== "0600") fail("MANIFEST_ENV", "runtime environment must be root:root 0600");
  if (!Array.isArray(value.allowedNames) || JSON.stringify([...value.allowedNames].sort()) !== JSON.stringify([...RUNTIME_ENVIRONMENT_NAMES])) fail("MANIFEST_ENV", "runtime environment allowlist differs from the exact app contract");
  for (const name of value.allowedNames) {
    if (typeof name !== "string" || !/^[A-Z][A-Z0-9_]{0,127}$/u.test(name)) fail("MANIFEST_ENV", "runtime environment name is malformed");
    if (/SERVICE_?ROLE/iu.test(name)) fail("SERVICE_ROLE_FORBIDDEN", "service_role environment names are forbidden");
  }
}

export function classifyRuntimeEnvironment(entries, allowedNames) {
  if (!Array.isArray(entries)) fail("RUNTIME_ENV_INVALID", "runtime environment entries must be an array");
  const allowed = new Set(allowedNames);
  const names = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).sort().join(",") !== "name,value") {
      fail("RUNTIME_ENV_INVALID", "runtime environment entries are malformed");
    }
    const name = entry.name;
    if (typeof name !== "string" || name !== name.toUpperCase() || !allowed.has(name) || names.has(name)) {
      fail("RUNTIME_ENV_INVALID", "runtime environment contains an unknown or duplicate name");
    }
    names.add(name);
    if (/SERVICE_?ROLE/iu.test(name)) fail("SERVICE_ROLE_FORBIDDEN", "service_role environment names are forbidden");
    const value = entry.value;
    if (typeof value !== "string" || value.length === 0 || value.includes("\u0000")) fail("RUNTIME_ENV_INVALID", "runtime environment contains an invalid value");
    const jwt = value.split(".");
    if (jwt.length === 3) {
      try {
        const payload = JSON.parse(Buffer.from(jwt[1], "base64url").toString("utf8"));
        if (String(payload?.role ?? "").toLowerCase() === "service_role") fail("SERVICE_ROLE_FORBIDDEN", "service_role credentials are forbidden");
      } catch (error) {
        if (error?.code === "SERVICE_ROLE_FORBIDDEN") throw error;
      }
    }
    if (/^(?:sb_secret_|service_role\b)/iu.test(value)) fail("SERVICE_ROLE_FORBIDDEN", "privileged Supabase credentials are forbidden");
    if (name === "NEXT_PUBLIC_SUPABASE_URL") {
      let parsed;
      try { parsed = new URL(value); } catch { fail("RUNTIME_ENV_INVALID", "public Supabase URL is malformed"); }
      if (parsed.protocol !== "https:" || !/^[a-z0-9]{20}[.]supabase[.]co$/u.test(parsed.hostname) || parsed.pathname !== "/" || parsed.search || parsed.hash) fail("RUNTIME_ENV_INVALID", "public Supabase URL is not canonical");
    } else if (name === "NEXT_PUBLIC_SUPABASE_ANON_KEY") {
      let isAnon = /^sb_publishable_[A-Za-z0-9_-]+$/u.test(value);
      if (!isAnon && jwt.length === 3) {
        try { isAnon = JSON.parse(Buffer.from(jwt[1], "base64url").toString("utf8"))?.role === "anon"; } catch { isAnon = false; }
      }
      if (!isAnon) fail("RUNTIME_ENV_INVALID", "public Supabase key privilege cannot be proven anon/publishable");
    } else if (name === "NEXT_PUBLIC_POSTHOG_KEY" && !/^phc_[A-Za-z0-9]+$/u.test(value)) {
      fail("RUNTIME_ENV_INVALID", "public analytics key is malformed");
    } else if (name === "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY") {
      let decoded;
      try { decoded = Buffer.from(value, "base64"); } catch { fail("RUNTIME_ENV_INVALID", "Server Actions key is malformed"); }
      if (decoded.length !== 32 || decoded.toString("base64") !== value) fail("RUNTIME_ENV_INVALID", "Server Actions key must be canonical 32-byte base64");
    } else if (name === "NEXT_TELEMETRY_DISABLED" && value !== "1") {
      fail("RUNTIME_ENV_INVALID", "telemetry policy differs from the reviewed runtime");
    }
  }
  if (names.size !== allowed.size) fail("RUNTIME_ENV_INVALID", "runtime environment is missing a required name");
  return Object.freeze([...names].sort());
}

export function validateProvisionManifest(manifest, { auditSummary } = {}) {
  exactKeys(manifest, TOP_KEYS, "manifest");
  if (manifest.schema !== PROVISION_SCHEMA || !SHA40.test(manifest.sourceSha) || !SHA64.test(manifest.auditSha256) || !SHA64.test(manifest.auditHostIdentitySha256) || !SHA64.test(manifest.preservedStateSha256)) {
    fail("MANIFEST_IDENTITY", "manifest identity is invalid");
  }
  if (manifest.securityModel !== "trusted_deployer" || manifest.bootStrategy !== "condition_path_both_enabled") {
    fail("MANIFEST_POLICY", "manifest policy differs from the current-source-compatible contract");
  }
  exactKeys(manifest.accounts, ["deploy", "service"], "accounts");
  validateAccount(manifest.accounts.service, SERVICE_ACCOUNT, "accounts.service");
  validateAccount(manifest.accounts.deploy, DEPLOY_ACCOUNT, "accounts.deploy");
  if (manifest.accounts.service.uid === manifest.accounts.deploy.uid || manifest.accounts.service.gid === manifest.accounts.deploy.gid) fail("MANIFEST_ACCOUNT", "service and deploy identities must be distinct");
  if (JSON.stringify(manifest.accounts.deploy.supplementaryGids) !== JSON.stringify([manifest.accounts.service.gid])) {
    fail("MANIFEST_ACCOUNT", "deploy supplementary groups must contain only the service primary group");
  }

  exactKeys(manifest.node, ["arch", "archiveSha256", "downloadUrl", "platform", "version"], "node");
  if (manifest.node.version !== RUNTIME_NODE_VERSION || manifest.node.platform !== "linux" || !["x64", "arm64"].includes(manifest.node.arch) || !SHA64.test(manifest.node.archiveSha256)) {
    fail("MANIFEST_NODE", "Node runtime identity is invalid");
  }
  let nodeUrl;
  try { nodeUrl = new URL(manifest.node.downloadUrl); } catch { fail("MANIFEST_NODE", "Node download URL is invalid"); }
  if (nodeUrl.protocol !== "https:" || nodeUrl.hostname !== "nodejs.org" || !nodeUrl.pathname.includes("v22.23.2")) fail("MANIFEST_NODE", "Node download source is not the reviewed upstream");

  exactKeys(manifest.ports, ["blue", "green"], "ports");
  const bluePort = boundedInteger(manifest.ports.blue, 1024, 65535, "ports.blue");
  const greenPort = boundedInteger(manifest.ports.green, 1024, 65535, "ports.green");
  if (bluePort === greenPort) fail("MANIFEST_PORT", "slot ports must be distinct");

  exactKeys(manifest.resources, ["cpuQuotaPerSecUSec", "memoryMaxBytes", "restartUSec", "tasksMax"], "resources");
  boundedInteger(manifest.resources.restartUSec, 1_000, 300_000_000, "resources.restartUSec");
  boundedInteger(manifest.resources.memoryMaxBytes, 16 * 1024 * 1024, 8 * 1024 * 1024 * 1024, "resources.memoryMaxBytes");
  boundedInteger(manifest.resources.tasksMax, 8, 4096, "resources.tasksMax");
  boundedInteger(manifest.resources.cpuQuotaPerSecUSec, 10_000, 8_000_000, "resources.cpuQuotaPerSecUSec");
  if (manifest.resources.cpuQuotaPerSecUSec % 10_000 !== 0) fail("MANIFEST_VALUE", "CPU quota must map to an exact systemd percentage");

  exactKeys(manifest.paths, PATH_KEYS, "paths");
  for (const key of PATH_KEYS) exactAbsolute(manifest.paths[key], `paths.${key}`);
  if (manifest.paths.releaseRoot !== "/srv/moawork" || manifest.paths.runtimeEnvFile !== "/etc/moawork/runtime.env" || manifest.paths.releaseConfigFile !== "/etc/moawork/release.json") {
    fail("MANIFEST_PATH", "core paths differ from the reviewed MoaWork layout");
  }
  if (manifest.paths.nodePath !== `/opt/moawork/node-${RUNTIME_NODE_VERSION.slice(1)}/bin/node`) fail("MANIFEST_PATH", "Node path is not version-dedicated");
  if (manifest.paths.upstreamFile !== path.posix.join(manifest.paths.caddyManagedDirectory, "active.caddy")) fail("MANIFEST_PATH", "managed upstream path is invalid");
  const pathValues = Object.values(manifest.paths);
  if (new Set(pathValues).size !== pathValues.length) fail("MANIFEST_PATH", "manifest paths must be pairwise distinct");

  exactKeys(manifest.executables, ["caddyPath", "systemctlPath"], "executables");
  exactAbsolute(manifest.executables.caddyPath, "executables.caddyPath");
  exactAbsolute(manifest.executables.systemctlPath, "executables.systemctlPath");
  if (path.posix.basename(manifest.executables.caddyPath) !== "caddy" || path.posix.basename(manifest.executables.systemctlPath) !== "systemctl") fail("MANIFEST_PATH", "executable basenames are invalid");

  exactKeys(manifest.trustedBuilder, ["bytesSha256", "fingerprintSha256"], "trustedBuilder");
  if (!SHA64.test(manifest.trustedBuilder.bytesSha256) || !SHA64.test(manifest.trustedBuilder.fingerprintSha256)) fail("MANIFEST_TRUST", "trusted builder identity is invalid");
  validateRuntimeEnvironment(manifest.runtimeEnvironment);

  if (!Array.isArray(manifest.hostLabels) || manifest.hostLabels.length === 0 || new Set(manifest.hostLabels).size !== manifest.hostLabels.length || manifest.hostLabels.some((value) => typeof value !== "string" || !SAFE_HOST.test(value))) {
    fail("MANIFEST_HOST", "host labels are invalid");
  }
  exactKeys(manifest.units, ["blueSha256", "greenSha256", "polkitSha256"], "units");
  for (const value of Object.values(manifest.units)) if (!SHA64.test(value)) fail("MANIFEST_UNIT", "unit or policy digest is invalid");
  exactKeys(manifest.caddy, ["closureSha256", "siteSha256"], "caddy");
  if (!SHA64.test(manifest.caddy.closureSha256) || !SHA64.test(manifest.caddy.siteSha256)) fail("MANIFEST_CADDY", "Caddy identity is invalid");

  if (!auditSummary || auditSummary.schema !== AUDIT_SCHEMA || auditSummary.complete !== true || auditSummary.sha256 !== manifest.auditSha256) fail("AUDIT_INCOMPLETE", "exact complete audit-v2 evidence is required");
  if (auditSummary.machineArch !== manifest.node.arch) fail("AUDIT_MISMATCH", "Node architecture differs from the audited host");
  if (auditSummary.hostIdentitySha256 !== manifest.auditHostIdentitySha256) fail("AUDIT_MISMATCH", "audited host identity differs from the exact target");
  const candidates = new Set(auditSummary.candidatePorts ?? []);
  if (!candidates.has(bluePort) || !candidates.has(greenPort)) fail("AUDIT_MISMATCH", "slot ports are not exact audited free candidates");
  if (auditSummary.preservedStateSha256 !== manifest.preservedStateSha256) fail("AUDIT_MISMATCH", "preserved host state differs from the manifest");
  return Object.freeze(structuredClone(manifest));
}

export function provisionManifestSha256(manifest, options) {
  return sha256Canonical(validateProvisionManifest(manifest, options));
}

export function provisionManagedTargets(manifest) {
  return Object.freeze([
    manifest.accounts.deploy.home,
    manifest.paths.releaseRoot,
    "/etc/moawork",
    manifest.paths.caddyManagedDirectory,
    path.posix.dirname(path.posix.dirname(path.posix.dirname(manifest.paths.nodePath))),
    manifest.paths.provisionLockFile,
    manifest.paths.runtimeEnvFile,
    manifest.paths.releaseConfigFile,
    manifest.paths.nodePath.replace(/\/bin\/node$/u, ""),
    manifest.paths.trustedBuilderPublicKeyPath,
    manifest.paths.polkitRuleFile,
    manifest.paths.caddySiteFile,
    "/etc/systemd/system/moawork-web-blue.service",
    "/etc/systemd/system/multi-user.target.wants/moawork-web-blue.service",
    "/etc/systemd/system/moawork-web-green.service",
    "/etc/systemd/system/multi-user.target.wants/moawork-web-green.service",
  ]);
}

export function trustedBuilderIdentity(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) fail("MANIFEST_TRUST", "trusted builder public key bytes are required");
  let key;
  try { key = createPublicKey(bytes); } catch { fail("MANIFEST_TRUST", "trusted builder public key is malformed"); }
  if (key.asymmetricKeyType !== "ed25519") fail("MANIFEST_TRUST", "trusted builder key must be Ed25519");
  const der = key.export({ type: "spki", format: "der" });
  return Object.freeze({ bytesSha256: createHash("sha256").update(bytes).digest("hex"), fingerprintSha256: createHash("sha256").update(der).digest("hex") });
}
