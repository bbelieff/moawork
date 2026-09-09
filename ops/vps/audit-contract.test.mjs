import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIT_REQUIRED_FIELDS_DIGEST,
  AUDIT_PATHS,
  AUDIT_REQUIRED_PATHS,
  AUDIT_REQUIRED_PROBES,
  AUDIT_SCHEMA,
  auditEvidenceDigest,
  auditPreservedStateDigest,
  requireAuditProbe,
  validateHostAudit,
} from "./audit-contract.mjs";

const digest = "a".repeat(64);
const health = { checks: [{ httpStatus: 200, identityDigest: digest, latencyMs: 12, scope: "local" }], state: "healthy" };
const service = {
  activeState: "active",
  cpuQuotaPerSecUSec: "infinity",
  cpuUsageNSec: "10",
  dropInDigest: digest,
  fragmentDigest: digest,
  group: "root",
  health,
  identityDigest: digest,
  loadState: "loaded",
  memoryCurrent: "1024",
  memoryMax: "infinity",
  restartCount: 0,
  restartPolicy: "on-failure",
  subState: "running",
  tasksCurrent: 3,
  tasksMax: "512",
  unit: "example.service",
  user: "root",
};

function valueFor(probe) {
  switch (probe) {
    case "identity.auditActor": return { egid: 0, euid: 0, supplementaryGids: [0] };
    case "identity.accounts": return [
      { gid: null, home: null, name: "moawork", passwordLocked: null, present: false, shell: null, supplementaryGids: [], uid: null },
      { gid: null, home: null, name: "moawork-deploy", passwordLocked: null, present: false, shell: null, supplementaryGids: [], uid: null },
    ];
    case "identity.machine": return { hostIdentityDigest: digest, kernelArch: "x86_64", kernelRelease: "6.8", kernelSystem: "Linux", kernelVersion: "v", nodeArch: "x64" };
    case "filesystem.paths": return AUDIT_REQUIRED_PATHS.map((logicalKey) => ({
      ancestors: [{ gid: 0, mode: "755", path: "/", realpath: "/", type: "directory", uid: 0 }],
      ancestorsSafe: true,
      gid: null,
      logicalKey,
      mode: null,
      nlink: null,
      path: AUDIT_PATHS[logicalKey],
      realpath: null,
      type: "absent",
      uid: null,
    }));
    case "filesystem.executables": return ["systemctl", "caddy", "docker"].map((name) => ({ digest, gid: 0, mode: "755", name, nlink: 1, path: "/usr/bin/" + name, realpath: "/usr/bin/" + name, type: "regular file", uid: 0 }));
    case "listeners.all": return { digest, listenCount: 3, query: "tcp-and-udp-all-address-families" };
    case "listeners.candidatePorts": return [3000, 3100, 3101, 3102].flatMap((port) => ["ipv4", "ipv6"].map((addressFamily) => ({ addressFamily, listenCount: 0, loopbackOnly: true, port, recheckedAtUtc: "2026-09-09T00:00:01Z" })));
    case "caddy.root": return { configPath: "/etc/caddy/Caddyfile", digest, endsWithNewline: true, gid: 0, managedImportOccurrences: 0, mode: "644", nlink: 1, realpath: "/etc/caddy/Caddyfile", type: "regular file", uid: 0, unmanagedDigest: digest };
    case "caddy.closure": return { adaptedDigest: digest, complete: true, digest, entries: [{ digest, gid: 0, mode: "644", nlink: 1, pathDigest: digest, realpathDigest: digest, type: "regular file", uid: 0 }], entryCount: 1 };
    case "caddy.validate": return { adapter: "caddyfile", configPath: "/etc/caddy/Caddyfile", mode: "read-only-adapt", validated: false, validationDigest: digest };
    case "services.caddy": return { ...service, unit: "caddy.service" };
    case "services.docker": return { ...service, health: { checks: [], state: "not-applicable" }, unit: "docker.service" };
    case "services.salespt": return { ...service, unit: "salespt-bot.service" };
    case "services.hermes": return { containerCount: 1, containers: [{ health: "healthy", identityDigest: digest, index: 1, memoryBytes: 1024, nanoCpus: 500000000, pidsLimit: 128, restartCount: 0, state: "running" }] };
    case "resources.host": return { cpuCount: 4, diskRootAvailableKiB: 10, diskRootTotalKiB: 20, load1: "0.10", load15: "0.10", load5: "0.10", memAvailableKiB: 10, memTotalKiB: 20, swapFreeKiB: 5, swapTotalKiB: 5 };
    case "resources.samples": return Array.from({ length: 5 }, (_, index) => ({ host: { load1: "0.10", memAvailableKiB: 10, swapFreeKiB: 5 }, sampledAtUtc: `2026-09-09T00:00:0${index + 1}Z`, services: ["caddy.service", "docker.service", "salespt-bot.service"].map((unit) => ({ cpuUsageNSec: "1", memoryCurrentBytes: "2", tasksCurrent: 3, unit })) }));
    case "globalNode": return { arch: "x64", digest, gid: 0, mode: "755", nlink: 1, path: "/usr/local/bin/node", platform: "linux", realpath: "/usr/local/bin/node", type: "regular file", uid: 0, version: "v24.1.0" };
    default: throw new Error("unhandled probe " + probe);
  }
}

function completeReport() {
  const probes = Object.fromEntries(AUDIT_REQUIRED_PROBES.map((probe) => [probe, { reasonCode: null, state: "ok", value: valueFor(probe) }]));
  return {
    complete: true,
    incompleteReasons: [],
    observedAtUtc: "2026-09-09T00:00:03Z",
    probes,
    provenance: {
      collector: "ops/vps/audit-host-readonly.sh",
      collectorVersion: 2,
      evidenceSource: "fixture",
      evidenceDigest: auditEvidenceDigest(probes, "fixture"),
      requiredFieldsDigest: AUDIT_REQUIRED_FIELDS_DIGEST,
      rootRequired: true,
      transport: "stdout-json",
    },
    schema: AUDIT_SCHEMA,
  };
}

test("complete v2 report validates and exposes required evidence", () => {
  const report = completeReport();
  assert.equal(validateHostAudit(report, { allowFixture: true, requireComplete: true }), report);
  assert.throws(() => validateHostAudit(report, { requireComplete: true }), /fixture evidence is not production evidence/u);
  assert.throws(() => requireAuditProbe(report, "identity.machine"), /fixture evidence is not production evidence/u);
  assert.match(auditPreservedStateDigest(report, { allowFixture: true }), /^[a-f0-9]{64}$/u);
});

test("missing, error, and rootless evidence cannot collapse to complete", () => {
  const report = completeReport();
  report.complete = false;
  report.probes["listeners.all"] = { reasonCode: "LISTENER_QUERY_FAILED", state: "error", value: null };
  report.incompleteReasons = [{ code: "LISTENER_QUERY_FAILED", probe: "listeners.all" }];
  report.provenance.evidenceDigest = auditEvidenceDigest(report.probes, report.provenance.evidenceSource);
  assert.doesNotThrow(() => validateHostAudit(report));
  assert.throws(() => validateHostAudit(report, { requireComplete: true }), /complete audit evidence is required/u);

  const rootless = completeReport();
  rootless.complete = false;
  rootless.probes["identity.auditActor"].value.euid = 1000;
  rootless.provenance.evidenceDigest = auditEvidenceDigest(rootless.probes, rootless.provenance.evidenceSource);
  assert.doesNotThrow(() => validateHostAudit(rootless));
  assert.throws(() => validateHostAudit(rootless, { requireComplete: true }), /complete audit evidence is required/u);
});

test("schema drift, unknown probes, and evidence tampering fail closed", () => {
  const missing = completeReport();
  delete missing.probes.globalNode;
  assert.throws(() => validateHostAudit(missing), /required probe set differs/u);

  const extra = completeReport();
  extra.probes.extra = { reasonCode: null, state: "ok", value: null };
  assert.throws(() => validateHostAudit(extra), /required probe set differs/u);

  const tampered = completeReport();
  tampered.probes["identity.machine"].value.kernelArch = "other";
  assert.throws(() => validateHostAudit(tampered), /evidenceDigest does not match probes/u);

  const laundered = completeReport();
  laundered.provenance.evidenceSource = "host-observation";
  assert.throws(() => validateHostAudit(laundered, { requireComplete: true }), /evidenceDigest does not match probes and evidence source/u);
});

test("unbounded counters remain lossless across JSON transport and digest replay", () => {
  const report = completeReport();
  report.probes["services.caddy"].value.cpuUsageNSec = "9007199254740993";
  report.probes["resources.samples"].value[0].services[0].cpuUsageNSec = "18446744073709551615";
  report.provenance.evidenceDigest = auditEvidenceDigest(report.probes, report.provenance.evidenceSource);
  const transported = JSON.parse(JSON.stringify(report));
  assert.equal(transported.probes["services.caddy"].value.cpuUsageNSec, "9007199254740993");
  assert.equal(transported.provenance.evidenceDigest, auditEvidenceDigest(transported.probes, transported.provenance.evidenceSource));
  assert.doesNotThrow(() => validateHostAudit(transported, { allowFixture: true, requireComplete: true }));
});

test("every non-null probe value has an exact closed shape", () => {
  const report = completeReport();
  report.probes["identity.machine"].value.unexpected = true;
  report.provenance.evidenceDigest = auditEvidenceDigest(report.probes, report.provenance.evidenceSource);
  assert.throws(() => validateHostAudit(report), /identity\.machine keys differ/u);
});

test("required logical paths are bound to their exact producer targets", () => {
  const report = completeReport();
  assert.equal(AUDIT_PATHS["moawork.deployHome"], "/home/moawork-deploy");
  assert.ok(report.probes["filesystem.paths"].value.some(({ logicalKey, path }) => logicalKey === "moawork.deployHome" && path === "/home/moawork-deploy"));
  report.probes["filesystem.paths"].value.find(({ logicalKey }) => logicalKey === "moawork.releaseState").path = "/etc/moawork/release.json";
  report.provenance.evidenceDigest = auditEvidenceDigest(report.probes, report.provenance.evidenceSource);
  assert.throws(() => validateHostAudit(report, { allowFixture: true, requireComplete: true }), /releaseState target differs/u);
});

test("ancestor safety is derived from the exact root-first chain and DAC", () => {
  const empty = completeReport();
  empty.probes["filesystem.paths"].value[0].ancestors = [];
  empty.provenance.evidenceDigest = auditEvidenceDigest(empty.probes, empty.provenance.evidenceSource);
  assert.throws(() => validateHostAudit(empty, { allowFixture: true, requireComplete: true }), /ancestor chain length differs/u);

  const forgedSafe = completeReport();
  forgedSafe.probes["filesystem.paths"].value[0].ancestors[0] = { gid: 1000, mode: "775", path: "/", realpath: "/", type: "directory", uid: 1000 };
  forgedSafe.provenance.evidenceDigest = auditEvidenceDigest(forgedSafe.probes, forgedSafe.provenance.evidenceSource);
  assert.throws(() => validateHostAudit(forgedSafe, { allowFixture: true, requireComplete: true }), /ancestor safety does not match metadata/u);

  const wrongPrefix = completeReport();
  wrongPrefix.probes["filesystem.paths"].value[0].ancestors[0].path = "/tmp";
  wrongPrefix.provenance.evidenceDigest = auditEvidenceDigest(wrongPrefix.probes, wrongPrefix.provenance.evidenceSource);
  assert.throws(() => validateHostAudit(wrongPrefix, { allowFixture: true, requireComplete: true }), /ancestor chain differs/u);
});

test("preserved-state digest excludes observation-only usage and timestamps", () => {
  const first = completeReport();
  const second = structuredClone(first);
  second.probes["resources.samples"].value[0].host.load1 = "9.00";
  second.probes["services.caddy"].value.cpuUsageNSec = "999";
  second.probes["services.caddy"].value.memoryCurrent = "999";
  second.probes["listeners.candidatePorts"].value[0].recheckedAtUtc = "2026-09-09T00:04:00Z";
  second.probes["listeners.candidatePorts"].value[0].listenCount = 1;
  second.probes["identity.accounts"].value[0] = { gid: 1000, home: "/srv/moawork", name: "moawork", passwordLocked: true, present: true, shell: "/usr/sbin/nologin", supplementaryGids: [1000], uid: 1000 };
  second.probes["filesystem.paths"].value[0] = {
    ...second.probes["filesystem.paths"].value[0],
    ancestors: ["/", "/etc", "/etc/caddy", "/etc/caddy/moawork.d"].map((path) => ({ gid: 0, mode: "755", path, realpath: path, type: "directory", uid: 0 })),
    gid: 0,
    mode: "644",
    nlink: 1,
    realpath: AUDIT_PATHS["caddy.active"],
    type: "regular file",
    uid: 0,
  };
  second.probes["caddy.closure"].value.digest = "c".repeat(64);
  second.observedAtUtc = "2026-09-09T00:04:01Z";
  second.provenance.evidenceDigest = auditEvidenceDigest(second.probes, second.provenance.evidenceSource);
  assert.equal(auditPreservedStateDigest(first, { allowFixture: true }), auditPreservedStateDigest(second, { allowFixture: true }));
  second.probes["identity.machine"].value.hostIdentityDigest = "b".repeat(64);
  second.provenance.evidenceDigest = auditEvidenceDigest(second.probes, second.provenance.evidenceSource);
  assert.notEqual(auditPreservedStateDigest(first, { allowFixture: true }), auditPreservedStateDigest(second, { allowFixture: true }));
});
