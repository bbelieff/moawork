import { createHash, generateKeyPairSync } from "node:crypto";
import {
  AUDIT_PATHS,
  AUDIT_REQUIRED_FIELDS_DIGEST,
  AUDIT_REQUIRED_PATHS,
  AUDIT_REQUIRED_PROBES,
  AUDIT_SCHEMA,
  auditEvidenceDigest,
} from "../audit-contract.mjs";
import { renderProvisionAssets } from "./assets.mjs";
import { provisionManagedTargets, trustedBuilderIdentity } from "./manifest.mjs";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const TEST_PUBLIC_KEY = Buffer.from(generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }));

export function provisionFixture() {
  const auditSummary = {
    schema: "moawork-vps-readonly-v2",
    complete: true,
    sha256: SHA_A,
    hostIdentitySha256: "6".repeat(64),
    machineArch: "x64",
    candidatePorts: [3101, 3102],
    preservedStateSha256: SHA_B,
  };
  const manifest = {
    schema: "moawork-vps-provision-v1",
    sourceSha: "c".repeat(40),
    auditSha256: SHA_A,
    auditHostIdentitySha256: "6".repeat(64),
    preservedStateSha256: SHA_B,
    securityModel: "trusted_deployer",
    bootStrategy: "condition_path_both_enabled",
    accounts: {
      service: { name: "moawork", uid: 2101, gid: 2101, home: "/nonexistent", shell: "/usr/sbin/nologin", passwordLocked: true, supplementaryGids: [] },
      deploy: { name: "moawork-deploy", uid: 2102, gid: 2102, home: "/home/moawork-deploy", shell: "/bin/bash", passwordLocked: true, supplementaryGids: [2101] },
    },
    node: {
      version: "v22.23.2",
      platform: "linux",
      arch: "x64",
      downloadUrl: "https://nodejs.org/dist/v22.23.2/node-v22.23.2-linux-x64.tar.xz",
      archiveSha256: "d".repeat(64),
    },
    ports: { blue: 3101, green: 3102 },
    resources: { restartUSec: 5_000_000, memoryMaxBytes: 1_073_741_824, tasksMax: 512, cpuQuotaPerSecUSec: 200_000 },
    paths: {
      caddyConfigFile: "/etc/caddy/Caddyfile",
      caddyManagedDirectory: "/etc/caddy/moawork.d",
      caddySiteFile: "/etc/caddy/moawork.caddy",
      lockFile: "/srv/moawork/release.lock",
      nodePath: "/opt/moawork/node-22.23.2/bin/node",
      polkitRuleFile: "/etc/polkit-1/rules.d/70-moawork-deploy.rules",
      provisionLockFile: "/run/lock/moawork-provision.lock",
      releaseConfigFile: "/etc/moawork/release.json",
      releaseRoot: "/srv/moawork",
      runtimeEnvFile: "/etc/moawork/runtime.env",
      stateFile: "/srv/moawork/state.json",
      trustedBuilderPublicKeyPath: "/etc/moawork/trusted-builder.pem",
      upstreamFile: "/etc/caddy/moawork.d/active.caddy",
    },
    executables: { caddyPath: "/usr/bin/caddy", systemctlPath: "/usr/bin/systemctl" },
    trustedBuilder: trustedBuilderIdentity(TEST_PUBLIC_KEY),
    runtimeEnvironment: { allowedNames: ["NEXT_PUBLIC_POSTHOG_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY", "NEXT_TELEMETRY_DISABLED"], owner: "root", group: "root", mode: "0600" },
    hostLabels: ["moa-work.com", "www.moa-work.com"],
    units: { blueSha256: "1".repeat(64), greenSha256: "2".repeat(64), polkitSha256: "3".repeat(64) },
    caddy: { closureSha256: "4".repeat(64), siteSha256: "5".repeat(64) },
  };
  const assets = renderProvisionAssets(manifest);
  manifest.units = { blueSha256: assets.blueUnit.sha256, greenSha256: assets.greenUnit.sha256, polkitSha256: assets.polkit.sha256 };
  manifest.caddy = {
    siteSha256: assets.caddySite.sha256,
    closureSha256: (awaitHash(`import ${manifest.paths.caddySiteFile}\0${assets.caddySite.bytes}`)),
  };
  return { auditSummary, manifest, trustedBuilderBytes: TEST_PUBLIC_KEY };
}

export function runtimeEnvironmentFixture() {
  const payload = Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url");
  return [
    { name: "NEXT_PUBLIC_SUPABASE_URL", value: "https://abcdefghijklmnopqrst.supabase.co" },
    { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", value: `x.${payload}.y` },
    { name: "NEXT_PUBLIC_POSTHOG_KEY", value: "phc_abc123" },
    { name: "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY", value: Buffer.alloc(32, 7).toString("base64") },
    { name: "NEXT_TELEMETRY_DISABLED", value: "1" },
  ];
}

export function provisionPrestate(manifest) {
  const absent = provisionManagedTargets(manifest).map((path) => ({ path, state: "absent" }));
  return {
    schema: "moawork-vps-provision-prestate-v1",
    auditSha256: manifest.auditSha256,
    preservedStateSha256: manifest.preservedStateSha256,
    servicesSha256: "9".repeat(64),
    caddyRoot: {
      digest: awaitHash("existing caddy root\n"),
      endsWithNewline: true,
      gid: 0,
      mode: "644",
      nlink: 1,
      path: manifest.paths.caddyConfigFile,
      realpath: manifest.paths.caddyConfigFile,
      uid: 0,
      unmanagedDigest: awaitHash("existing caddy root\n"),
    },
    accounts: { service: { state: "absent" }, deploy: { state: "absent" } },
    managedPaths: [...absent, { path: manifest.paths.caddyConfigFile, state: "existing_preserved" }],
  };
}

function awaitHash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const AUDIT_DIGEST = "e".repeat(64);
const AUDIT_HEALTH = { checks: [{ httpStatus: 200, identityDigest: AUDIT_DIGEST, latencyMs: 12, scope: "local" }], state: "healthy" };
const AUDIT_SERVICE = {
  activeState: "active", cpuQuotaPerSecUSec: "infinity", cpuUsageNSec: "10", dropInDigest: AUDIT_DIGEST,
  fragmentDigest: AUDIT_DIGEST, group: "root", health: AUDIT_HEALTH, identityDigest: AUDIT_DIGEST,
  loadState: "loaded", memoryCurrent: "1024", memoryMax: "infinity", restartCount: 0,
  restartPolicy: "on-failure", subState: "running", tasksCurrent: 3, tasksMax: "512", user: "root",
};

function ancestors(target) {
  const parts = target.split("/").filter(Boolean);
  const values = [{ gid: 0, mode: "755", path: "/", realpath: "/", type: "directory", uid: 0 }];
  let current = "";
  for (const part of parts.slice(0, -1)) {
    current += `/${part}`;
    values.push({ gid: 0, mode: "755", path: current, realpath: current, type: "directory", uid: 0 });
  }
  return values;
}

function auditPath(logicalKey, patch = {}) {
  const target = AUDIT_PATHS[logicalKey];
  const present = patch.type && patch.type !== "absent";
  const result = {
    ancestors: present ? ancestors(target) : [{ gid: 0, mode: "755", path: "/", realpath: "/", type: "directory", uid: 0 }],
    ancestorsSafe: true,
    gid: present ? 0 : null,
    logicalKey,
    mode: present ? "755" : null,
    nlink: present ? 1 : null,
    path: target,
    realpath: present ? target : null,
    type: "absent",
    uid: present ? 0 : null,
    ...patch,
  };
  if (result.type === "directory" && patch.nlink === undefined) result.nlink = 2;
  return result;
}

function auditValue(probe, manifest, after) {
  switch (probe) {
    case "identity.auditActor": return { egid: 0, euid: 0, supplementaryGids: [0] };
    case "identity.accounts": return after ? [manifest.accounts.service, manifest.accounts.deploy].map((account) => ({
      gid: account.gid,
      home: account.home,
      name: account.name,
      passwordLocked: account.passwordLocked,
      present: true,
      shell: account.shell,
      supplementaryGids: account.supplementaryGids,
      uid: account.uid,
    })) : [
      { gid: null, home: null, name: manifest.accounts.service.name, passwordLocked: null, present: false, shell: null, supplementaryGids: [], uid: null },
      { gid: null, home: null, name: manifest.accounts.deploy.name, passwordLocked: null, present: false, shell: null, supplementaryGids: [], uid: null },
    ];
    case "identity.machine": return { hostIdentityDigest: manifest.auditHostIdentitySha256, kernelArch: "x86_64", kernelRelease: "6.8", kernelSystem: "Linux", kernelVersion: "v", nodeArch: manifest.node.arch };
    case "filesystem.paths": {
      const values = AUDIT_REQUIRED_PATHS.map((key) => auditPath(key));
      const set = (key, patch) => Object.assign(values.find((entry) => entry.logicalKey === key), auditPath(key, patch));
      set("caddy.root", { type: "regular file", mode: "644", realpath: manifest.paths.caddyConfigFile });
      if (after) {
        set("moawork.deployHome", { type: "directory", uid: manifest.accounts.deploy.uid, gid: manifest.accounts.deploy.gid, mode: "750", realpath: manifest.accounts.deploy.home });
        set("moawork.root", { type: "directory", uid: manifest.accounts.deploy.uid, gid: manifest.accounts.service.gid, mode: "750", realpath: manifest.paths.releaseRoot });
        set("moawork.config", { type: "directory", gid: manifest.accounts.service.gid, mode: "750", realpath: "/etc/moawork" });
        set("caddy.managedDirectory", { type: "directory", uid: manifest.accounts.deploy.uid, mode: "755", realpath: manifest.paths.caddyManagedDirectory });
        set("global.nodeParent", { type: "directory", mode: "755", realpath: "/opt/moawork" });
        set("global.nodeRoot", { type: "directory", mode: "755", realpath: manifest.paths.nodePath.replace(/\/bin\/node$/u, "") });
        set("global.nodeTarget", { type: "regular file", mode: "755", realpath: manifest.paths.nodePath });
        set("moawork.runtimeEnv", { type: "regular file", mode: "600", realpath: manifest.paths.runtimeEnvFile });
        set("moawork.releaseConfig", { type: "regular file", mode: "644", realpath: manifest.paths.releaseConfigFile });
        set("moawork.trustedBuilderKey", { type: "regular file", gid: manifest.accounts.service.gid, mode: "440", realpath: manifest.paths.trustedBuilderPublicKeyPath });
        set("systemd.policy", { type: "regular file", mode: "644", realpath: manifest.paths.polkitRuleFile });
        set("caddy.include", { type: "regular file", mode: "644", realpath: manifest.paths.caddySiteFile });
        set("systemd.blue", { type: "regular file", mode: "644", realpath: "/etc/systemd/system/moawork-web-blue.service" });
        set("systemd.green", { type: "regular file", mode: "644", realpath: "/etc/systemd/system/moawork-web-green.service" });
        set("systemd.blueEnabled", { type: "symbolic link", mode: "777", realpath: "/etc/systemd/system/moawork-web-blue.service" });
        set("systemd.greenEnabled", { type: "symbolic link", mode: "777", realpath: "/etc/systemd/system/moawork-web-green.service" });
      }
      return values;
    }
    case "filesystem.executables": return [["systemctl", manifest.executables.systemctlPath], ["caddy", manifest.executables.caddyPath], ["docker", "/usr/bin/docker"]].map(([name, target]) => ({ digest: AUDIT_DIGEST, gid: 0, mode: "755", name, nlink: 1, path: target, realpath: target, type: "regular file", uid: 0 }));
    case "listeners.all": return { digest: AUDIT_DIGEST, listenCount: 3, query: "tcp-and-udp-all-address-families" };
    case "listeners.candidatePorts": return [3000, 3100, 3101, 3102].flatMap((port) => ["ipv4", "ipv6"].map((addressFamily) => ({ addressFamily, listenCount: 0, loopbackOnly: true, port, recheckedAtUtc: after ? "2026-09-09T07:34:30Z" : "2026-09-09T07:29:30Z" })));
    case "caddy.root": return { configPath: manifest.paths.caddyConfigFile, digest: after ? "f".repeat(64) : AUDIT_DIGEST, endsWithNewline: true, gid: 0, managedImportOccurrences: after ? 1 : 0, mode: "644", nlink: 1, realpath: manifest.paths.caddyConfigFile, type: "regular file", uid: 0, unmanagedDigest: AUDIT_DIGEST };
    case "caddy.closure": return { adaptedDigest: AUDIT_DIGEST, complete: true, digest: AUDIT_DIGEST, entries: [{ digest: AUDIT_DIGEST, gid: 0, mode: "644", nlink: 1, pathDigest: AUDIT_DIGEST, realpathDigest: AUDIT_DIGEST, type: "regular file", uid: 0 }], entryCount: 1 };
    case "caddy.validate": return { adapter: "caddyfile", configPath: manifest.paths.caddyConfigFile, mode: "read-only-adapt", validated: false, validationDigest: AUDIT_DIGEST };
    case "services.caddy": return { ...AUDIT_SERVICE, unit: "caddy.service" };
    case "services.docker": return { ...AUDIT_SERVICE, health: { checks: [], state: "not-applicable" }, unit: "docker.service" };
    case "services.salespt": return { ...AUDIT_SERVICE, unit: "salespt-bot.service" };
    case "services.hermes": return { containerCount: 1, containers: [{ health: "healthy", identityDigest: AUDIT_DIGEST, index: 1, memoryBytes: 1024, nanoCpus: 500000000, pidsLimit: 128, restartCount: 0, state: "running" }] };
    case "resources.host": return { cpuCount: 4, diskRootAvailableKiB: 10, diskRootTotalKiB: 20, load1: "0.10", load15: "0.10", load5: "0.10", memAvailableKiB: 10, memTotalKiB: 20, swapFreeKiB: 5, swapTotalKiB: 5 };
    case "resources.samples": return Array.from({ length: 5 }, (_, index) => ({ host: { load1: "0.10", memAvailableKiB: 10, swapFreeKiB: 5 }, sampledAtUtc: `2026-09-09T07:${after ? "34" : "29"}:0${index + 1}Z`, services: ["caddy.service", "docker.service", "salespt-bot.service"].map((unit) => ({ cpuUsageNSec: "1", memoryCurrentBytes: "2", tasksCurrent: 3, unit })) }));
    case "globalNode": return { arch: "x64", digest: AUDIT_DIGEST, gid: 0, mode: "755", nlink: 1, path: "/usr/local/bin/node", platform: "linux", realpath: "/usr/local/bin/node", type: "regular file", uid: 0, version: "v24.1.0" };
    default: throw new Error(`unhandled probe ${probe}`);
  }
}

export function provisionAuditReportFixture(manifest, { after = false } = {}) {
  const probes = Object.fromEntries(AUDIT_REQUIRED_PROBES.map((probe) => [probe, { reasonCode: null, state: "ok", value: auditValue(probe, manifest, after) }]));
  return {
    complete: true,
    incompleteReasons: [],
    observedAtUtc: after ? "2026-09-09T07:34:45Z" : "2026-09-09T07:29:45Z",
    probes,
    provenance: {
      collector: "ops/vps/audit-host-readonly.sh",
      collectorVersion: 2,
      evidenceSource: "host-observation",
      evidenceDigest: auditEvidenceDigest(probes, "host-observation"),
      requiredFieldsDigest: AUDIT_REQUIRED_FIELDS_DIGEST,
      rootRequired: true,
      transport: "stdout-json",
    },
    schema: AUDIT_SCHEMA,
  };
}
