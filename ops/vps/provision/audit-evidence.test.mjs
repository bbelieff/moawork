import assert from "node:assert/strict";
import test from "node:test";

import { deriveProvisionAuditEvidence } from "./audit-evidence.mjs";
import { provisionFixture } from "./test-fixtures.mjs";
import { provisionManagedTargets } from "./manifest.mjs";

const NOW = Date.parse("2026-09-09T07:30:00Z");

function setup() {
  const { manifest } = provisionFixture();
  const value = (value) => ({ state: "ok", reasonCode: null, value });
  const paths = provisionManagedTargets(manifest).map((target) => ({ path: target, type: "absent", realpath: null, nlink: null, ancestorsSafe: true }));
  paths.push({ path: manifest.paths.caddyConfigFile, type: "regular file", realpath: manifest.paths.caddyConfigFile, nlink: 1, ancestorsSafe: true });
  const service = { identityDigest: "1".repeat(64) };
  const report = {
    schema: "moawork-vps-readonly-v2",
    complete: true,
    observedAtUtc: "2026-09-09T07:29:00Z",
    provenance: { evidenceDigest: manifest.auditSha256 },
    probes: {
      "identity.machine": value({ nodeArch: manifest.node.arch, hostIdentityDigest: manifest.auditHostIdentitySha256 }),
      "identity.accounts": value([
        { name: manifest.accounts.service.name, present: false, uid: null, gid: null },
        { name: manifest.accounts.deploy.name, present: false, uid: null, gid: null },
      ]),
      "filesystem.paths": value(paths),
      "filesystem.executables": value([
        { name: "caddy", path: manifest.executables.caddyPath, realpath: manifest.executables.caddyPath, type: "regular file", nlink: 1, mode: "0755" },
        { name: "systemctl", path: manifest.executables.systemctlPath, realpath: manifest.executables.systemctlPath, type: "regular file", nlink: 1, mode: "0755" },
      ]),
      "listeners.candidatePorts": value([
        ...[manifest.ports.blue, manifest.ports.green].flatMap((port) => ["ipv4", "ipv6"].map((addressFamily) => ({ port, addressFamily, listenCount: 0, loopbackOnly: true, recheckedAtUtc: "2026-09-09T07:29:30Z" }))),
      ]),
      "caddy.root": value({ configPath: manifest.paths.caddyConfigFile, digest: "2".repeat(64), endsWithNewline: true, gid: 0, managedImportOccurrences: 0, mode: "644", type: "regular file", nlink: 1, realpath: manifest.paths.caddyConfigFile, uid: 0, unmanagedDigest: "3".repeat(64) }),
      "caddy.closure": value({ adaptedDigest: "4".repeat(64), complete: true, entryCount: 1, entries: [{}] }),
      "caddy.validate": value({ configPath: manifest.paths.caddyConfigFile, mode: "read-only-adapt", validated: false, validationDigest: "4".repeat(64) }),
      "services.caddy": value(service),
      "services.docker": value(service),
      "services.hermes": value(service),
      "services.salespt": value(service),
    },
  };
  const contract = {
    AUDIT_SCHEMA: "moawork-vps-readonly-v2",
    validateHostAudit(candidate, { requireComplete }) {
      if (candidate !== report || requireComplete !== true || candidate.complete !== true) throw new Error("invalid audit");
      return candidate;
    },
    requireAuditProbe(candidate, key, predicate) {
      this.validateHostAudit(candidate, { requireComplete: true });
      const probe = candidate.probes[key];
      if (!probe || probe.state !== "ok" || !predicate(probe.value)) throw new Error("probe rejected");
      return probe.value;
    },
    auditPreservedStateDigest() { return manifest.preservedStateSha256; },
  };
  return { manifest, report, contract };
}

test("derives manifest evidence and absent prestate only from a complete fresh audit contract", () => {
  const { manifest, report, contract } = setup();
  const evidence = deriveProvisionAuditEvidence(report, manifest, contract, { nowMs: NOW });
  assert.equal(evidence.auditSummary.sha256, manifest.auditSha256);
  assert.equal(evidence.auditSummary.hostIdentitySha256, manifest.auditHostIdentitySha256);
  assert.deepEqual(evidence.auditSummary.candidatePorts, [manifest.ports.blue, manifest.ports.green]);
  assert.equal(evidence.prestate.managedPaths.find((entry) => entry.path === manifest.paths.releaseRoot).state, "absent");
});

test("rejects stale/future evidence and target host, architecture, port, path, or executable drift", () => {
  const mutations = [
    ({ report }) => { report.observedAtUtc = "2026-09-09T07:00:00Z"; },
    ({ report }) => { report.observedAtUtc = "2026-09-09T07:31:00Z"; },
    ({ report }) => { report.probes["identity.machine"].value.hostIdentityDigest = "0".repeat(64); },
    ({ report }) => { report.probes["identity.machine"].value.nodeArch = "arm64"; },
    ({ report }) => { report.probes["listeners.candidatePorts"].value[0].listenCount = 1; },
    ({ report, manifest }) => { report.probes["filesystem.paths"].value.find((entry) => entry.path === manifest.paths.releaseRoot).type = "directory"; },
    ({ report }) => { report.probes["filesystem.executables"].value[0].mode = "0777"; },
  ];
  for (const mutate of mutations) {
    const value = setup();
    mutate(value);
    assert.throws(() => deriveProvisionAuditEvidence(value.report, value.manifest, value.contract, { nowMs: NOW }));
  }
});

test("rejects caller claims that do not pass the repository audit validator", () => {
  const value = setup();
  value.report.complete = false;
  assert.throws(() => deriveProvisionAuditEvidence(value.report, value.manifest, value.contract, { nowMs: NOW }));
});
