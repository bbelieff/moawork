import { createHash } from "node:crypto";

export const AUDIT_SCHEMA = "moawork-vps-readonly-v2";

export const AUDIT_REQUIRED_PROBES = Object.freeze([
  "caddy.closure",
  "caddy.root",
  "caddy.validate",
  "filesystem.executables",
  "filesystem.paths",
  "identity.auditActor",
  "identity.accounts",
  "identity.machine",
  "listeners.all",
  "listeners.candidatePorts",
  "resources.host",
  "resources.samples",
  "services.caddy",
  "services.docker",
  "services.hermes",
  "services.salespt",
  "globalNode",
]);

export const AUDIT_CANDIDATE_PORTS = Object.freeze([3000, 3100, 3101, 3102]);
export const AUDIT_PATHS = Object.freeze({
  "caddy.active": "/etc/caddy/moawork.d/active.caddy",
  "caddy.include": "/etc/caddy/moawork.caddy",
  "caddy.managedDirectory": "/etc/caddy/moawork.d",
  "caddy.root": "/etc/caddy/Caddyfile",
  "global.nodeLink": "/usr/local/bin/node",
  "global.nodeParent": "/opt/moawork",
  "global.nodeRoot": "/opt/moawork/node-22.23.2",
  "global.nodeTarget": "/opt/moawork/node-22.23.2/bin/node",
  "moawork.config": "/etc/moawork",
  "moawork.deployHome": "/home/moawork-deploy",
  "moawork.provisionLock": "/run/lock/moawork-provision.lock",
  "moawork.releaseConfig": "/etc/moawork/release.json",
  "moawork.releaseLock": "/srv/moawork/release.lock",
  "moawork.releaseState": "/srv/moawork/state.json",
  "moawork.root": "/srv/moawork",
  "moawork.runtimeEnv": "/etc/moawork/runtime.env",
  "moawork.trustedBuilderKey": "/etc/moawork/trusted-builder.pem",
  "systemd.blue": "/etc/systemd/system/moawork-web-blue.service",
  "systemd.blueEnabled": "/etc/systemd/system/multi-user.target.wants/moawork-web-blue.service",
  "systemd.green": "/etc/systemd/system/moawork-web-green.service",
  "systemd.greenEnabled": "/etc/systemd/system/multi-user.target.wants/moawork-web-green.service",
  "systemd.policy": "/etc/polkit-1/rules.d/70-moawork-deploy.rules",
});
export const AUDIT_REQUIRED_PATHS = Object.freeze(Object.keys(AUDIT_PATHS));

const TOP_LEVEL_KEYS = [
  "complete",
  "incompleteReasons",
  "observedAtUtc",
  "probes",
  "provenance",
  "schema",
];
const PROBE_KEYS = ["reasonCode", "state", "value"];
const PROVENANCE_KEYS = [
  "collector",
  "collectorVersion",
  "evidenceSource",
  "evidenceDigest",
  "requiredFieldsDigest",
  "rootRequired",
  "transport",
];
const REASON_KEYS = ["code", "probe"];
const STATES = new Set(["ok", "absent", "unknown", "error"]);

export const AUDIT_VALUE_KEYS = Object.freeze({
  account: ["gid", "home", "name", "passwordLocked", "present", "shell", "supplementaryGids", "uid"],
  caddyClosure: ["adaptedDigest", "complete", "digest", "entries", "entryCount"],
  caddyEntry: ["digest", "gid", "mode", "nlink", "pathDigest", "realpathDigest", "type", "uid"],
  caddyRoot: ["configPath", "digest", "endsWithNewline", "gid", "managedImportOccurrences", "mode", "nlink", "realpath", "type", "uid", "unmanagedDigest"],
  caddyValidate: ["adapter", "configPath", "mode", "validated", "validationDigest"],
  candidatePort: ["addressFamily", "listenCount", "loopbackOnly", "port", "recheckedAtUtc"],
  executable: ["digest", "gid", "mode", "name", "nlink", "path", "realpath", "type", "uid"],
  globalNode: ["arch", "digest", "gid", "mode", "nlink", "path", "platform", "realpath", "type", "uid", "version"],
  hostResources: ["cpuCount", "diskRootAvailableKiB", "diskRootTotalKiB", "load1", "load15", "load5", "memAvailableKiB", "memTotalKiB", "swapFreeKiB", "swapTotalKiB"],
  listenerInventory: ["digest", "listenCount", "query"],
  machine: ["hostIdentityDigest", "kernelArch", "kernelRelease", "kernelSystem", "kernelVersion", "nodeArch"],
  path: ["ancestors", "ancestorsSafe", "gid", "logicalKey", "mode", "nlink", "path", "realpath", "type", "uid"],
  pathAncestor: ["gid", "mode", "path", "realpath", "type", "uid"],
  resourceSample: ["host", "sampledAtUtc", "services"],
  resourceSampleHost: ["load1", "memAvailableKiB", "swapFreeKiB"],
  resourceSampleService: ["cpuUsageNSec", "memoryCurrentBytes", "tasksCurrent", "unit"],
  service: ["activeState", "cpuQuotaPerSecUSec", "cpuUsageNSec", "dropInDigest", "fragmentDigest", "group", "health", "identityDigest", "loadState", "memoryCurrent", "memoryMax", "restartCount", "restartPolicy", "subState", "tasksCurrent", "tasksMax", "unit", "user"],
  serviceHealth: ["checks", "state"],
  serviceHealthCheck: ["httpStatus", "identityDigest", "latencyMs", "scope"],
  hermes: ["containerCount", "containers"],
  hermesContainer: ["health", "identityDigest", "index", "memoryBytes", "nanoCpus", "pidsLimit", "restartCount", "state"],
});

function fail(message) {
  throw new TypeError(`invalid audit-v2 report: ${message}`);
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    fail(`${label} keys differ`);
  }
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export const AUDIT_REQUIRED_FIELDS_DIGEST = sha256(canonicalJson({
  candidatePorts: AUDIT_CANDIDATE_PORTS,
  probes: AUDIT_REQUIRED_PROBES,
  provenanceKeys: PROVENANCE_KEYS,
  requiredPaths: AUDIT_PATHS,
  valueKeys: AUDIT_VALUE_KEYS,
}));

export function auditEvidenceDigest(probes, evidenceSource) {
  if (!["host-observation", "fixture"].includes(evidenceSource)) fail("evidenceSource is invalid for digesting");
  const lines = [`provenance.evidenceSource\u001f${evidenceSource}\n`, ...Object.keys(probes).sort().map((key) => {
    const probe = probes[key];
    // The collector hashes the exact JSON value text it emits. JSON.parse keeps
    // object insertion order, so JSON.stringify reproduces that transport
    // identity without requiring a second JSON implementation in Bash.
    return `${key}\u001f${probe.state}\u001f${JSON.stringify(probe.value)}\u001f${probe.reasonCode ?? ""}\n`;
  })];
  return sha256(lines.join(""));
}

function validateProbe(key, probe) {
  exactKeys(probe, PROBE_KEYS, `probe ${key}`);
  if (!STATES.has(probe.state)) fail(`probe ${key} state is invalid`);
  if (probe.reasonCode !== null && (typeof probe.reasonCode !== "string" || !/^[A-Z][A-Z0-9_]*$/u.test(probe.reasonCode))) {
    fail(`probe ${key} reasonCode is invalid`);
  }
  if (probe.state !== "ok" && probe.reasonCode === null) {
    fail(`probe ${key} needs a reasonCode`);
  }
  if (probe.state === "ok" && probe.reasonCode !== null) fail(`probe ${key} ok state cannot have a reasonCode`);
  if (probe.state === "ok" && probe.value === null) fail(`probe ${key} ok state cannot have null value`);
}

function assertArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
}

function exactArrayObjects(value, keys, label) {
  assertArray(value, label);
  value.forEach((entry, index) => exactKeys(entry, keys, `${label}[${index}]`));
}

function validateValueShape(key, probe) {
  const { state, value } = probe;
  if (value === null && state !== "ok") return;
  switch (key) {
    case "identity.auditActor":
      exactKeys(value, ["egid", "euid", "supplementaryGids"], key);
      assertArray(value.supplementaryGids, `${key}.supplementaryGids`);
      break;
    case "identity.accounts":
      exactArrayObjects(value, AUDIT_VALUE_KEYS.account, key);
      break;
    case "identity.machine":
      exactKeys(value, AUDIT_VALUE_KEYS.machine, key);
      break;
    case "filesystem.paths":
      exactArrayObjects(value, AUDIT_VALUE_KEYS.path, key);
      value.forEach((entry, index) => exactArrayObjects(entry.ancestors, AUDIT_VALUE_KEYS.pathAncestor, `${key}[${index}].ancestors`));
      break;
    case "filesystem.executables":
      exactArrayObjects(value, AUDIT_VALUE_KEYS.executable, key);
      break;
    case "listeners.all":
      exactKeys(value, AUDIT_VALUE_KEYS.listenerInventory, key);
      break;
    case "listeners.candidatePorts":
      exactArrayObjects(value, AUDIT_VALUE_KEYS.candidatePort, key);
      break;
    case "caddy.root":
      exactKeys(value, AUDIT_VALUE_KEYS.caddyRoot, key);
      break;
    case "caddy.closure":
      exactKeys(value, AUDIT_VALUE_KEYS.caddyClosure, key);
      exactArrayObjects(value.entries, AUDIT_VALUE_KEYS.caddyEntry, `${key}.entries`);
      break;
    case "caddy.validate":
      exactKeys(value, AUDIT_VALUE_KEYS.caddyValidate, key);
      break;
    case "services.caddy":
    case "services.docker":
    case "services.salespt":
      exactKeys(value, AUDIT_VALUE_KEYS.service, key);
      exactKeys(value.health, AUDIT_VALUE_KEYS.serviceHealth, `${key}.health`);
      exactArrayObjects(value.health.checks, AUDIT_VALUE_KEYS.serviceHealthCheck, `${key}.health.checks`);
      break;
    case "services.hermes":
      exactKeys(value, AUDIT_VALUE_KEYS.hermes, key);
      exactArrayObjects(value.containers, AUDIT_VALUE_KEYS.hermesContainer, `${key}.containers`);
      break;
    case "resources.host":
      exactKeys(value, AUDIT_VALUE_KEYS.hostResources, key);
      break;
    case "resources.samples":
      exactArrayObjects(value, AUDIT_VALUE_KEYS.resourceSample, key);
      value.forEach((entry, index) => {
        exactKeys(entry.host, AUDIT_VALUE_KEYS.resourceSampleHost, `${key}[${index}].host`);
        exactArrayObjects(entry.services, AUDIT_VALUE_KEYS.resourceSampleService, `${key}[${index}].services`);
      });
      break;
    case "globalNode":
      exactKeys(value, AUDIT_VALUE_KEYS.globalNode, key);
      break;
    default:
      fail(`no value shape exists for ${key}`);
  }
}

function isDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function sameSet(actual, expected) {
  return JSON.stringify([...new Set(actual)].sort()) === JSON.stringify([...expected].sort());
}

function isNonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isUnsignedDecimal(value) {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value);
}

function expectedAncestorPaths(target) {
  if (typeof target !== "string" || !target.startsWith("/")) fail("required path target is not absolute");
  const parts = target.split("/").filter(Boolean);
  const paths = ["/"];
  let current = "";
  for (const part of parts.slice(0, -1)) {
    current += `/${part}`;
    paths.push(current);
  }
  return paths;
}

function octalMode(value, label) {
  if (typeof value !== "string" || !/^[0-7]{3,4}$/u.test(value)) fail(`${label} mode is malformed`);
  return Number.parseInt(value, 8);
}

function validateAncestorEvidence(path) {
  const expected = expectedAncestorPaths(path.path);
  if (path.ancestors.length === 0 || path.ancestors.length > expected.length) fail(`path ${path.logicalKey} ancestor chain length differs`);
  let derivedSafe = true;
  path.ancestors.forEach((ancestor, index) => {
    if (ancestor.path !== expected[index]) fail(`path ${path.logicalKey} ancestor chain differs`);
    if (typeof ancestor.realpath !== "string" || ancestor.realpath.length === 0) fail(`path ${path.logicalKey} ancestor realpath is missing`);
    const mode = octalMode(ancestor.mode, `path ${path.logicalKey} ancestor`);
    if (ancestor.type !== "directory" || ancestor.uid !== 0 || ancestor.realpath !== ancestor.path
      || (mode & 0o002) !== 0 || ((mode & 0o020) !== 0 && ancestor.gid !== 0)) derivedSafe = false;
  });
  if (path.type !== "absent" && path.ancestors.length !== expected.length) fail(`path ${path.logicalKey} present ancestor chain is incomplete`);
  if (path.ancestorsSafe !== derivedSafe) fail(`path ${path.logicalKey} ancestor safety does not match metadata`);
}

function validateCompleteSemantics(report) {
  const value = (key) => report.probes[key].value;
  const actor = value("identity.auditActor");
  if (actor.euid !== 0 || !isNonnegativeInteger(actor.egid) || actor.supplementaryGids.some((gid) => !isNonnegativeInteger(gid))) fail("audit actor identity is malformed");
  if (!isDigest(value("identity.machine").hostIdentityDigest)) fail("machine hostIdentityDigest is malformed");
  const accounts = value("identity.accounts");
  if (accounts.length !== 2 || !sameSet(accounts.map((entry) => entry.name), ["moawork", "moawork-deploy"])) fail("account identity set differs");
  for (const account of accounts) {
    if (typeof account.present !== "boolean" || !Array.isArray(account.supplementaryGids) || account.supplementaryGids.some((gid) => !isNonnegativeInteger(gid))) fail(`account ${account.name} metadata is malformed`);
    if (account.present && (!isNonnegativeInteger(account.uid) || !isNonnegativeInteger(account.gid) || typeof account.passwordLocked !== "boolean")) fail(`account ${account.name} present metadata is incomplete`);
    if (!account.present && [account.uid, account.gid, account.passwordLocked, account.home, account.shell].some((entry) => entry !== null)) fail(`account ${account.name} absence is not authoritative`);
  }
  const paths = value("filesystem.paths");
  if (paths.length !== AUDIT_REQUIRED_PATHS.length || !sameSet(paths.map((entry) => entry.logicalKey), AUDIT_REQUIRED_PATHS)) fail("required path identity set differs");
  for (const path of paths) {
    if (path.path !== AUDIT_PATHS[path.logicalKey]) fail(`path ${path.logicalKey} target differs`);
    if (typeof path.ancestorsSafe !== "boolean" || !Array.isArray(path.ancestors) || path.ancestors.some((entry) => !isNonnegativeInteger(entry.uid) || !isNonnegativeInteger(entry.gid))) fail(`path ${path.logicalKey} metadata is malformed`);
    validateAncestorEvidence(path);
    if (path.type === "absent" && [path.uid, path.gid, path.mode, path.nlink, path.realpath].some((entry) => entry !== null)) fail(`path ${path.logicalKey} absence is not authoritative`);
    if (path.type !== "absent" && (!isNonnegativeInteger(path.uid) || !isNonnegativeInteger(path.gid) || !isNonnegativeInteger(path.nlink) || typeof path.realpath !== "string" || path.realpath.length === 0)) fail(`path ${path.logicalKey} identity is incomplete`);
    if (path.type !== "absent") octalMode(path.mode, `path ${path.logicalKey}`);
  }
  const executables = value("filesystem.executables");
  if (executables.length !== 3 || !sameSet(executables.map((entry) => entry.name), ["systemctl", "caddy", "docker"])) fail("required executable identity set differs");
  for (const executable of executables) {
    if (executable.type !== "regular file" || !isDigest(executable.digest)) fail(`executable ${executable.name} identity is incomplete`);
  }
  const ports = value("listeners.candidatePorts");
  const expectedPortKeys = AUDIT_CANDIDATE_PORTS.flatMap((port) => ["ipv4", "ipv6"].map((family) => `${port}:${family}`));
  if (ports.length !== expectedPortKeys.length || !sameSet(ports.map((entry) => `${entry.port}:${entry.addressFamily}`), expectedPortKeys)) fail("candidate port/family set differs");
  if (ports.some((entry) => !isNonnegativeInteger(entry.listenCount) || typeof entry.loopbackOnly !== "boolean" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(entry.recheckedAtUtc))) fail("candidate port evidence is malformed");
  if (!isDigest(value("listeners.all").digest) || !isNonnegativeInteger(value("listeners.all").listenCount) || value("listeners.all").query !== "tcp-and-udp-all-address-families") fail("listener inventory digest is malformed");
  const closure = value("caddy.closure");
  if (closure.complete !== true || closure.entryCount !== closure.entries.length || !isDigest(closure.digest) || !isDigest(closure.adaptedDigest)) fail("Caddy closure is incomplete");
  if (closure.entries.some((entry) => !isDigest(entry.digest) || !isDigest(entry.pathDigest) || !isDigest(entry.realpathDigest)
    || !isNonnegativeInteger(entry.uid) || !isNonnegativeInteger(entry.gid) || !isNonnegativeInteger(entry.nlink) || entry.nlink < 1
    || entry.type !== "regular file" || !/^[0-7]{3,4}$/u.test(entry.mode))) fail("Caddy closure entry identity is malformed");
  const caddyRoot = value("caddy.root");
  if (caddyRoot.type !== "regular file" || caddyRoot.nlink !== 1 || typeof caddyRoot.endsWithNewline !== "boolean" || !isDigest(caddyRoot.digest) || !isDigest(caddyRoot.unmanagedDigest)
    || !isNonnegativeInteger(caddyRoot.managedImportOccurrences) || !isDigest(value("caddy.validate").validationDigest)) fail("Caddy identity is incomplete");
  if (value("caddy.validate").validated !== false || value("caddy.validate").mode !== "read-only-adapt"
    || value("caddy.validate").validationDigest !== closure.adaptedDigest) fail("Caddy read-only syntax evidence differs");
  for (const key of ["services.caddy", "services.docker", "services.salespt"]) {
    if (!isDigest(value(key).identityDigest) || !isDigest(value(key).fragmentDigest) || !isDigest(value(key).dropInDigest) || !isNonnegativeInteger(value(key).restartCount)) fail(`${key} identity is malformed`);
    if (!isUnsignedDecimal(value(key).cpuUsageNSec) || !isUnsignedDecimal(value(key).memoryCurrent)) fail(`${key} counters are malformed`);
  }
  const hermes = value("services.hermes");
  if (hermes.containerCount !== hermes.containers.length || hermes.containers.some((entry) => !isDigest(entry.identityDigest))) fail("Hermes identities are incomplete");
  const samples = value("resources.samples");
  if (samples.length !== 5 || samples.some((entry) => !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(entry.sampledAtUtc)
    || entry.services.length !== 3
    || !sameSet(entry.services.map((service) => service.unit), ["caddy.service", "docker.service", "salespt-bot.service"])
    || entry.services.some((service) => !isUnsignedDecimal(service.cpuUsageNSec) || !isUnsignedDecimal(service.memoryCurrentBytes) || !isNonnegativeInteger(service.tasksCurrent)))) fail("resource sample contract differs");
  const globalNode = value("globalNode");
  if (!isDigest(globalNode.digest) || !isNonnegativeInteger(globalNode.uid) || !isNonnegativeInteger(globalNode.gid) || !isNonnegativeInteger(globalNode.nlink)) fail("global Node identity is malformed");
}

export function validateHostAudit(report, { allowFixture = false, requireComplete = false } = {}) {
  exactKeys(report, TOP_LEVEL_KEYS, "report");
  if (report.schema !== AUDIT_SCHEMA) fail("schema is not audit-v2");
  if (typeof report.observedAtUtc !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(report.observedAtUtc)) {
    fail("observedAtUtc is not second-precision UTC");
  }
  if (typeof report.complete !== "boolean") fail("complete must be boolean");
  if (!Array.isArray(report.incompleteReasons)) fail("incompleteReasons must be an array");
  exactKeys(report.provenance, PROVENANCE_KEYS, "provenance");
  if (report.provenance.collector !== "ops/vps/audit-host-readonly.sh"
    || report.provenance.collectorVersion !== 2
    || !["host-observation", "fixture"].includes(report.provenance.evidenceSource)
    || report.provenance.transport !== "stdout-json"
    || report.provenance.rootRequired !== true) {
    fail("collector provenance differs");
  }
  if (report.provenance.requiredFieldsDigest !== AUDIT_REQUIRED_FIELDS_DIGEST) fail("requiredFieldsDigest differs");
  if (!/^[a-f0-9]{64}$/u.test(report.provenance.evidenceDigest)) fail("evidenceDigest is malformed");

  if (!report.probes || typeof report.probes !== "object" || Array.isArray(report.probes)) fail("probes must be an object");
  const actualProbeKeys = Object.keys(report.probes).sort();
  if (JSON.stringify(actualProbeKeys) !== JSON.stringify([...AUDIT_REQUIRED_PROBES].sort())) fail("required probe set differs");
  for (const key of actualProbeKeys) {
    validateProbe(key, report.probes[key]);
    validateValueShape(key, report.probes[key]);
  }
  if (report.provenance.evidenceDigest !== auditEvidenceDigest(report.probes, report.provenance.evidenceSource)) fail("evidenceDigest does not match probes and evidence source");

  const expectedReasons = actualProbeKeys
    .filter((key) => report.probes[key].state !== "ok")
    .map((probe) => ({ code: report.probes[probe].reasonCode, probe }));
  for (const [index, reason] of report.incompleteReasons.entries()) {
    exactKeys(reason, REASON_KEYS, `incompleteReasons[${index}]`);
    if (typeof reason.code !== "string" || typeof reason.probe !== "string") fail("incomplete reason values must be strings");
  }
  if (canonicalJson(report.incompleteReasons) !== canonicalJson(expectedReasons)) fail("incompleteReasons do not match failed probes");

  const actor = report.probes["identity.auditActor"];
  const completeByEvidence = expectedReasons.length === 0
    && actor.state === "ok"
    && actor.value
    && actor.value.euid === 0;
  if (report.complete !== completeByEvidence) fail("complete does not match evidence and root boundary");
  if (report.complete) validateCompleteSemantics(report);
  if (requireComplete && !report.complete) fail("complete audit evidence is required");
  if (requireComplete && report.provenance.evidenceSource === "fixture" && !allowFixture) fail("fixture evidence is not production evidence");
  return report;
}

export function auditPreservedStateDigest(report, { allowFixture = false } = {}) {
  validateHostAudit(report, { allowFixture, requireComplete: true });
  const value = (key) => report.probes[key].value;
  const stableService = (key) => {
    const service = value(key);
    if (service === null) return null;
    const { cpuUsageNSec: _cpu, health: _health, memoryCurrent: _memory, tasksCurrent: _tasks, ...stable } = service;
    return stable;
  };
  const stableHermes = value("services.hermes") === null ? null : {
    containerCount: value("services.hermes").containerCount,
    containers: value("services.hermes").containers.map(({ health: _health, restartCount: _restarts, state: _state, ...entry }) => entry),
  };
  return sha256(canonicalJson({
    caddy: {
      rootUnmanagedDigest: value("caddy.root").unmanagedDigest,
    },
    executables: value("filesystem.executables"),
    globalNode: value("globalNode"),
    hermes: stableHermes,
    machine: value("identity.machine"),
    services: {
      caddy: stableService("services.caddy"),
      docker: stableService("services.docker"),
      salespt: stableService("services.salespt"),
    },
  }));
}

export function requireAuditProbe(report, probePath, predicate = () => true) {
  validateHostAudit(report, { requireComplete: true });
  if (!AUDIT_REQUIRED_PROBES.includes(probePath)) fail(`unknown required probe ${probePath}`);
  const probe = report.probes[probePath];
  if (probe.state !== "ok") fail(`probe ${probePath} is not ok`);
  if (!predicate(probe.value)) fail(`probe ${probePath} value is not accepted`);
  return probe.value;
}
