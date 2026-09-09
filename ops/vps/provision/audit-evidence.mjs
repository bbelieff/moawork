import { sha256Canonical, provisionManagedTargets } from "./manifest.mjs";

function fail(code, message) {
  throw Object.assign(new Error(message), { name: "ProvisionAuditEvidenceError", code });
}

function parseUtc(value, label, nowMs, maximumAgeMs) {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time > nowMs + 30_000 || nowMs - time > maximumAgeMs) fail("AUDIT_STALE", `${label} is stale, invalid, or from the future`);
  return time;
}

function modeNumber(value) {
  if (Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^0?[0-7]{3,4}$/u.test(value)) return Number.parseInt(value, 8);
  return NaN;
}

function requireContract(contract) {
  if (!contract
    || typeof contract.validateHostAudit !== "function"
    || typeof contract.requireAuditProbe !== "function"
    || typeof contract.auditPreservedStateDigest !== "function"
    || contract.AUDIT_SCHEMA !== "moawork-vps-readonly-v2") fail("AUDIT_CONTRACT", "the repository audit-v2 contract is unavailable");
}

export function deriveProvisionAuditEvidence(report, manifest, contract, { nowMs = Date.now(), maximumAgeMs = 5 * 60_000 } = {}) {
  requireContract(contract);
  contract.validateHostAudit(report, { requireComplete: true });
  parseUtc(report.observedAtUtc, "audit observation", nowMs, maximumAgeMs);
  const requireProbe = (key, predicate, message) => {
    try { return contract.requireAuditProbe(report, key, predicate); }
    catch (error) { throw Object.assign(new Error(message, { cause: error }), { name: "ProvisionAuditEvidenceError", code: "AUDIT_SEMANTICS" }); }
  };

  const machine = requireProbe("identity.machine", (value) => value?.nodeArch === manifest.node.arch
    && value?.hostIdentityDigest === manifest.auditHostIdentitySha256, "audited target host or architecture differs from the manifest");
  const accounts = requireProbe("identity.accounts", (value) => {
    if (!Array.isArray(value) || value.length !== 2) return false;
    const byName = new Map(value.map((account) => [account.name, account]));
    return [manifest.accounts.service.name, manifest.accounts.deploy.name].every((name) => {
      const account = byName.get(name);
      return account?.present === false && account.uid === null && account.gid === null;
    });
  }, "dedicated MoaWork accounts are not authoritatively absent");
  void accounts;

  const paths = requireProbe("filesystem.paths", (value) => Array.isArray(value), "managed path inventory is unavailable");
  const byPath = new Map(paths.map((entry) => [entry.path, entry]));
  for (const target of provisionManagedTargets(manifest)) {
    const entry = byPath.get(target);
    if (!entry || entry.type !== "absent" || entry.ancestorsSafe !== true || entry.realpath !== null || entry.nlink !== null) {
      fail("AUDIT_SEMANTICS", `managed target is not authoritative safe-absent: ${target}`);
    }
  }
  const caddyRootPath = byPath.get(manifest.paths.caddyConfigFile);
  if (!caddyRootPath || caddyRootPath.type !== "regular file" || caddyRootPath.nlink !== 1 || caddyRootPath.ancestorsSafe !== true) {
    fail("AUDIT_SEMANTICS", "Caddy root path is not one safe regular file");
  }

  const executables = requireProbe("filesystem.executables", (value) => Array.isArray(value), "executable inventory is unavailable");
  for (const [name, expectedPath] of [["caddy", manifest.executables.caddyPath], ["systemctl", manifest.executables.systemctlPath]]) {
    const executable = executables.find((entry) => entry.name === name);
    if (!executable || executable.path !== expectedPath || executable.realpath !== expectedPath || executable.type !== "regular file" || executable.nlink !== 1 || (modeNumber(executable.mode) & 0o022) !== 0) {
      fail("AUDIT_SEMANTICS", `${name} executable identity or DAC is unsafe`);
    }
  }

  const candidates = requireProbe("listeners.candidatePorts", (value) => Array.isArray(value), "candidate port inventory is unavailable");
  const candidatePorts = [];
  for (const expected of [manifest.ports.blue, manifest.ports.green]) {
    const matches = candidates.filter((entry) => entry.port === expected);
    if (matches.length !== 2 || JSON.stringify(matches.map((entry) => entry.addressFamily).sort()) !== JSON.stringify(["ipv4", "ipv6"])) {
      fail("AUDIT_SEMANTICS", `candidate port ${expected} address-family evidence is incomplete`);
    }
    for (const candidate of matches) {
      if (candidate.listenCount !== 0 || candidate.loopbackOnly !== true) fail("AUDIT_SEMANTICS", `candidate port ${expected} is not exact free and loopback-scoped`);
      parseUtc(candidate.recheckedAtUtc, `candidate port ${expected}`, nowMs, maximumAgeMs);
    }
    candidatePorts.push(expected);
  }

  const caddyRoot = requireProbe("caddy.root", (value) => value?.configPath === manifest.paths.caddyConfigFile
    && value?.type === "regular file" && value?.nlink === 1 && typeof value?.endsWithNewline === "boolean" && value?.managedImportOccurrences === 0,
  "Caddy root probe differs from the first-install manifest or already contains the managed import");
  const caddyClosure = requireProbe("caddy.closure", (value) => value?.complete === true
    && Number.isSafeInteger(value?.entryCount) && value.entryCount === value.entries?.length, "Caddy import closure is incomplete");
  requireProbe("caddy.validate", (value) => value?.configPath === manifest.paths.caddyConfigFile
    && value?.validated === false && value?.mode === "read-only-adapt"
    && value?.validationDigest === caddyClosure.adaptedDigest, "Caddy read-only adapter check did not pass");
  for (const key of ["services.caddy", "services.docker", "services.hermes", "services.salespt"]) requireProbe(key, (value) => value !== null, `${key} identity is unavailable`);

  const preservedStateSha256 = contract.auditPreservedStateDigest(report);
  if (preservedStateSha256 !== manifest.preservedStateSha256) fail("AUDIT_MISMATCH", "audited preserved host state differs from the manifest");
  const auditSha256 = report.provenance.evidenceDigest;
  const auditSummary = Object.freeze({
    schema: contract.AUDIT_SCHEMA,
    complete: true,
    sha256: auditSha256,
    hostIdentitySha256: machine.hostIdentityDigest,
    machineArch: machine.nodeArch,
    candidatePorts,
    caddyRootSha256: caddyRoot.digest,
    caddyUnmanagedSha256: caddyRoot.unmanagedDigest,
    preservedStateSha256,
  });
  const servicesSha256 = sha256Canonical({
    caddy: report.probes["services.caddy"].value,
    docker: report.probes["services.docker"].value,
    hermes: report.probes["services.hermes"].value,
    salespt: report.probes["services.salespt"].value,
  });
  const prestate = Object.freeze({
    schema: "moawork-vps-provision-prestate-v1",
    auditSha256,
    preservedStateSha256,
    servicesSha256,
    caddyRoot: {
      digest: caddyRoot.digest,
      endsWithNewline: caddyRoot.endsWithNewline,
      gid: caddyRoot.gid,
      mode: caddyRoot.mode,
      nlink: caddyRoot.nlink,
      path: caddyRoot.configPath,
      realpath: caddyRoot.realpath,
      uid: caddyRoot.uid,
      unmanagedDigest: caddyRoot.unmanagedDigest,
    },
    accounts: { service: { state: "absent" }, deploy: { state: "absent" } },
    managedPaths: [
      ...provisionManagedTargets(manifest).map((target) => ({ path: target, state: "absent" })),
      { path: manifest.paths.caddyConfigFile, state: "existing_preserved" },
    ],
  });
  return Object.freeze({ auditSummary, prestate });
}
