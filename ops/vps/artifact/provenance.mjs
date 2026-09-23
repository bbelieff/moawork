import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { chmod, lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { ArtifactContractError, verifyReleaseArtifact } from "./contract.mjs";

const SHA64 = /^[0-9a-f]{64}$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const STATEMENT_KEYS = ["builder", "ciEvidence", "predicateType", "runtimeEvidence", "schema", "subject"];
const SUBJECT_KEYS = ["archiveSha256", "manifestSha256", "serverActionsKeyFingerprint", "sourceSha", "sourceTree"];
const BUILDER_KEYS = ["arch", "nodeVersion", "npmVersion", "platform"];
const RUNTIME_EVIDENCE_KEYS = ["arch", "archiveSha256", "healthPath", "kind", "nodeVersion", "platform", "serverActionsKeyFingerprint", "sourceSha"];
const CI_EVIDENCE_KEYS = ["eventName", "job", "ref", "repository", "runAttempt", "runId", "runnerArch", "runnerOs", "sha", "workflowRef"];
const SIGNATURE_KEYS = ["algorithm", "keyId", "value"];
const SMOKE_EVIDENCE_KEYS = ["buildEvidence", "builder", "runtimeEvidence", "schema", "subject"];
const MAX_SMOKE_EVIDENCE_BYTES = 32 * 1024;
const execFile = promisify(execFileCallback);

function fail(code, message, cause) {
  throw new ArtifactContractError(code, message, cause === undefined ? {} : { cause });
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code, "expected an object");
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code, "object keys do not match the provenance contract");
  }
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function serverActionsFingerprint(value) {
  if (typeof value !== "string" || value !== value.trim() || /\s/u.test(value)) {
    fail("SERVER_ACTIONS_BUILD_KEY", "built Server Actions key is malformed");
  }
  const key = Buffer.from(value, "base64");
  if (![16, 24, 32].includes(key.length) || key.toString("base64") !== value) {
    fail("SERVER_ACTIONS_BUILD_KEY", "built Server Actions key is malformed");
  }
  return createHmac("sha256", key)
    .update("moawork:server-actions:fingerprint:v1")
    .digest("hex");
}

async function requireRegularFile(value, code, { maxBytes = null } = {}) {
  const resolved = path.resolve(value);
  const stats = await lstat(resolved).catch((error) => fail(code, "provenance input is unavailable", error));
  if (!stats.isFile() || stats.isSymbolicLink()) fail(code, "provenance inputs must be regular non-symlink files");
  if (maxBytes !== null && (!Number.isSafeInteger(stats.size) || stats.size < 1 || stats.size > maxBytes)) {
    fail(code, "provenance input exceeds the bounded evidence size");
  }
  return resolved;
}

async function assertPrivateSmokeControlPaths({ archivePath, manifestPath, smokeEvidencePath }) {
  if (typeof process.getuid !== "function") fail("ABI_SANDBOX", "runtime smoke control paths require POSIX ownership checks");
  const archive = await requireRegularFile(archivePath, "PROVENANCE_FILE");
  const manifest = await requireRegularFile(manifestPath, "PROVENANCE_FILE");
  const evidence = path.resolve(smokeEvidencePath);
  const controlDirectory = path.dirname(archive);
  if (path.dirname(manifest) !== controlDirectory || path.dirname(evidence) !== controlDirectory) {
    fail("ABI_SANDBOX", "runtime smoke inputs and evidence must share one private control directory");
  }
  const stats = await lstat(controlDirectory).catch((error) => fail("ABI_SANDBOX", "runtime smoke control directory is unavailable", error));
  if (!stats.isDirectory() || stats.isSymbolicLink() || stats.uid !== process.getuid() || (stats.mode & 0o777) !== 0o700) {
    fail("ABI_SANDBOX", "runtime smoke control directory must be an owned non-symlink mode-0700 directory");
  }
  try {
    await lstat(evidence);
    fail("ABI_SANDBOX", "runtime smoke evidence path must not already exist");
  } catch (error) {
    if (error instanceof ArtifactContractError) throw error;
    if (error?.code !== "ENOENT") fail("ABI_SANDBOX", "runtime smoke evidence path cannot be inspected", error);
  }
  return Object.freeze({ archivePath: archive, manifestPath: manifest, smokeEvidencePath: evidence });
}

function publicKeyIdentity(publicKey) {
  if (publicKey.asymmetricKeyType !== "ed25519") fail("PROVENANCE_KEY", "trusted builder key must be Ed25519");
  return sha256(publicKey.export({ type: "spki", format: "der" }));
}

function descriptorSubject(descriptor) {
  return {
    sourceSha: descriptor.sourceSha,
    sourceTree: descriptor.sourceTree,
    archiveSha256: descriptor.archiveSha256,
    manifestSha256: descriptor.manifestSha256,
    serverActionsKeyFingerprint: descriptor.serverActionsKeyFingerprint,
  };
}

export function releaseProvenanceStatement(descriptor, runtimeEvidence, ciEvidence) {
  return {
    schema: 1,
    predicateType: "moawork.trusted-linux-next-standalone/v1",
    subject: descriptorSubject(descriptor),
    builder: { ...descriptor.builder },
    runtimeEvidence: { ...runtimeEvidence },
    ciEvidence: { ...ciEvidence },
  };
}

function protectedCiEvidence(descriptor, environment = process.env) {
  const evidence = {
    eventName: environment.GITHUB_EVENT_NAME,
    job: environment.GITHUB_JOB,
    ref: environment.GITHUB_REF,
    repository: environment.GITHUB_REPOSITORY,
    runAttempt: environment.GITHUB_RUN_ATTEMPT,
    runId: environment.GITHUB_RUN_ID,
    runnerArch: environment.RUNNER_ARCH,
    runnerOs: environment.RUNNER_OS,
    sha: environment.GITHUB_SHA,
    workflowRef: environment.GITHUB_WORKFLOW_REF,
  };
  if (
    environment.GITHUB_ACTIONS !== "true"
    || environment.GITHUB_REF_PROTECTED !== "true"
    || evidence.eventName !== "workflow_dispatch"
    || evidence.job !== "release-artifact"
    || evidence.ref !== "refs/heads/main"
    || evidence.repository !== "bbelieff/moawork"
    || evidence.sha !== descriptor.sourceSha
    || !/^[1-9][0-9]*$/u.test(evidence.runId ?? "")
    || !/^[1-9][0-9]*$/u.test(evidence.runAttempt ?? "")
    || evidence.runnerOs !== "Linux"
    || !(["x64", "arm64"].includes(descriptor.builder.arch)
      && evidence.runnerArch === descriptor.builder.arch.toUpperCase())
    || !/^bbelieff\/moawork\/[.]github\/workflows\/[^@]+@refs\/heads\/main$/u.test(evidence.workflowRef ?? "")
  ) fail("PROVENANCE_CI", "trusted signing requires the protected exact-main Linux release-artifact job");
  return Object.freeze(evidence);
}

function protectedBuildEvidence(descriptor, environment = process.env) {
  const evidence = {
    eventName: environment.GITHUB_EVENT_NAME,
    job: environment.GITHUB_JOB,
    ref: environment.GITHUB_REF,
    repository: environment.GITHUB_REPOSITORY,
    runAttempt: environment.GITHUB_RUN_ATTEMPT,
    runId: environment.GITHUB_RUN_ID,
    runnerArch: environment.RUNNER_ARCH,
    runnerOs: environment.RUNNER_OS,
    sha: environment.GITHUB_SHA,
    workflowRef: environment.GITHUB_WORKFLOW_REF,
  };
  if (
    environment.GITHUB_ACTIONS !== "true"
    || environment.GITHUB_REF_PROTECTED !== "true"
    || evidence.eventName !== "workflow_dispatch"
    || evidence.job !== "build-smoke"
    || evidence.ref !== "refs/heads/main"
    || evidence.repository !== "bbelieff/moawork"
    || evidence.sha !== descriptor.sourceSha
    || !/^[1-9][0-9]*$/u.test(evidence.runId ?? "")
    || !/^[1-9][0-9]*$/u.test(evidence.runAttempt ?? "")
    || evidence.runnerOs !== "Linux"
    || !(["x64", "arm64"].includes(descriptor.builder.arch)
      && evidence.runnerArch === descriptor.builder.arch.toUpperCase())
    || !/^bbelieff\/moawork\/[.]github\/workflows\/[^@]+@refs\/heads\/main$/u.test(evidence.workflowRef ?? "")
  ) fail("PROVENANCE_CI", "runtime smoke requires the protected exact-main Linux build-smoke job");
  return Object.freeze(evidence);
}

function validateCiEvidence(evidence, descriptor) {
  exactKeys(evidence, CI_EVIDENCE_KEYS, "PROVENANCE_CI");
  if (
    evidence.eventName !== "workflow_dispatch"
    || evidence.job !== "release-artifact"
    || evidence.ref !== "refs/heads/main"
    || evidence.repository !== "bbelieff/moawork"
    || evidence.sha !== descriptor.sourceSha
    || !/^[1-9][0-9]*$/u.test(evidence.runId ?? "")
    || !/^[1-9][0-9]*$/u.test(evidence.runAttempt ?? "")
    || evidence.runnerOs !== "Linux"
    || evidence.runnerArch !== descriptor.builder.arch.toUpperCase()
    || !/^bbelieff\/moawork\/[.]github\/workflows\/[^@]+@refs\/heads\/main$/u.test(evidence.workflowRef ?? "")
  ) fail("PROVENANCE_CI", "signed CI evidence does not bind the protected exact-main Linux builder");
  return evidence;
}

function validateBuildEvidence(evidence, descriptor, signingEvidence) {
  exactKeys(evidence, CI_EVIDENCE_KEYS, "PROVENANCE_CI");
  if (
    evidence.eventName !== "workflow_dispatch"
    || evidence.job !== "build-smoke"
    || evidence.ref !== "refs/heads/main"
    || evidence.repository !== "bbelieff/moawork"
    || evidence.sha !== descriptor.sourceSha
    || evidence.runId !== signingEvidence.runId
    || evidence.runAttempt !== signingEvidence.runAttempt
    || evidence.runnerOs !== "Linux"
    || evidence.runnerArch !== descriptor.builder.arch.toUpperCase()
    || evidence.workflowRef !== signingEvidence.workflowRef
  ) fail("PROVENANCE_CI", "runtime smoke evidence does not bind the exact signing workflow run");
  return evidence;
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") fail("ABI_SMOKE", "could not reserve a loopback port");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function systemctlValue(unit, property) {
  try {
    const { stdout } = await execFile("/usr/bin/systemctl", ["show", unit, `--property=${property}`, "--value"], {
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

export async function assertTransientUnitEmpty(unit, controlGroup, {
  run = execFile,
  readProperty = systemctlValue,
  readEvents = readFile,
} = {}) {
  if (!controlGroup) controlGroup = await readProperty(unit, "ControlGroup");
  try {
    await run("/usr/bin/sudo", ["--non-interactive", "/usr/bin/systemctl", "stop", unit], {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    });
  } catch {
    // A runtime may already have exited. The cgroup check below, not the stop
    // command's status, is the authoritative descendant-cleanup boundary.
  }
  if (!controlGroup && await readProperty(unit, "LoadState") === "not-found") return;
  if (typeof controlGroup !== "string" || !controlGroup.startsWith("/") || controlGroup.includes("..")) {
    fail("ABI_SANDBOX", "transient runtime cgroup identity is unavailable");
  }
  const eventsPath = path.join("/sys/fs/cgroup", controlGroup, "cgroup.events");
  try {
    const events = await readEvents(eventsPath, "utf8");
    if (!/(?:^|\n)populated 0(?:\n|$)/u.test(events)) fail("ABI_SANDBOX", "transient runtime cgroup still has descendants");
  } catch (error) {
    if (error instanceof ArtifactContractError) throw error;
    if (error?.code !== "ENOENT") fail("ABI_SANDBOX", "transient runtime cgroup cleanup cannot be verified", error);
  }
}

export async function runTransientSmokeService({ unit, startArgs, credentialPath, probe }, {
  run = execFile,
  removeCredential = (file) => rm(file, { force: true }),
  readProperty = systemctlValue,
  stopAndVerify = assertTransientUnitEmpty,
} = {}) {
  let controlGroup = "";
  // The manager may accept the unit before the client reports a timeout. Cleanup
  // therefore owns the entire submission, not only the successful-start path.
  try {
    try {
      await run("/usr/bin/sudo", startArgs, {
        encoding: "utf8",
        env: { PATH: "/usr/bin:/bin" },
        timeout: 10_000,
        windowsHide: true,
      });
    } catch {
      fail("ABI_SANDBOX", "hardened transient runtime could not start");
    }
    await removeCredential(credentialPath);
    controlGroup = await readProperty(unit, "ControlGroup");
    return await probe(controlGroup);
  } finally {
    try {
      await stopAndVerify(unit, controlGroup);
    } finally {
      // A deletion error cannot skip unit cleanup, including after start errors.
      await removeCredential(credentialPath);
    }
  }
}

async function assertMainPidInControlGroup(mainPid, controlGroup) {
  if (!Number.isSafeInteger(mainPid) || mainPid <= 0 || !controlGroup) {
    fail("ABI_SANDBOX", "transient runtime process identity is unavailable");
  }
  let membership;
  try {
    membership = await readFile(`/proc/${mainPid}/cgroup`, "utf8");
  } catch (error) {
    fail("ABI_SANDBOX", "transient runtime process identity cannot be verified", error);
  }
  if (!membership.split("\n").includes(`0::${controlGroup}`)) {
    fail("ABI_SANDBOX", "health target is outside the transient runtime cgroup");
  }
}

async function makeRuntimeTreeReadOnly(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) await makeRuntimeTreeReadOnly(target);
    else if (entry.isFile()) await chmod(target, 0o444);
    else fail("ABI_SANDBOX", "runtime smoke tree contains an unsupported entry");
  }
  await chmod(root, 0o555);
}

async function makeRuntimeTreeRemovable(root) {
  await chmod(root, 0o700).catch(() => {});
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) await makeRuntimeTreeRemovable(path.join(root, entry.name));
  }
}

export function nativeSmokeRuntimePaths(releaseRoot) {
  const serviceRoot = "/tmp/moawork-runtime";
  return Object.freeze({
    hostEntrypoint: path.join(releaseRoot, "runtime", "app", "server.js"),
    appRoot: `${serviceRoot}/runtime/app`,
    entrypoint: `${serviceRoot}/runtime/app/server.js`,
    bindProperty: `BindReadOnlyPaths=${releaseRoot}:${serviceRoot}`,
  });
}

async function proveNativeLinuxRuntime({ releaseRoot, descriptor, controlDirectory }) {
  if (process.platform !== "linux") fail("BUILDER_PLATFORM", "runtime evidence may be produced only on native Linux");
  const runtimeKey = process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY;
  // Keep the fingerprint implementation byte-identical to the app's HMAC
  // without ever serializing the key into an artifact or attestation.
  const hmacFingerprint = runtimeKey
    ? createHmac("sha256", Buffer.from(runtimeKey, "base64"))
        .update("moawork:server-actions:fingerprint:v1")
        .digest("hex")
    : null;
  if (hmacFingerprint !== descriptor.serverActionsKeyFingerprint) {
    fail("SERVER_ACTIONS_BUILD_FINGERPRINT", "native runtime key does not match the build-consumed fingerprint");
  }
  const { appRoot, entrypoint, hostEntrypoint, bindProperty } = nativeSmokeRuntimePaths(releaseRoot);
  await requireRegularFile(hostEntrypoint, "ABI_SMOKE");
  const port = await reserveLoopbackPort();
  const runtimeEnvironment = {
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    MOAWORK_BUILD_SHA: descriptor.sourceSha,
    MOAWORK_RELEASE_SHA: descriptor.sourceSha,
    MOAWORK_ARTIFACT_SHA256: descriptor.archiveSha256,
  };
  const unit = `moawork-smoke-${randomUUID().replaceAll("-", "")}.service`;
  const credentialPath = path.join(controlDirectory, `.server-actions-${randomUUID()}`);
  await writeFile(credentialPath, runtimeKey, { flag: "wx", mode: 0o600 });
  const properties = [
    "DynamicUser=yes",
    "PrivateTmp=yes",
    "NoNewPrivileges=yes",
    "CapabilityBoundingSet=",
    "AmbientCapabilities=",
    "ProtectSystem=strict",
    "ProtectHome=yes",
    "ProtectProc=invisible",
    "ProcSubset=pid",
    "ProtectControlGroups=yes",
    "ProtectKernelLogs=yes",
    "ProtectKernelModules=yes",
    "ProtectKernelTunables=yes",
    "RestrictNamespaces=yes",
    "RestrictSUIDSGID=yes",
    "PrivateDevices=yes",
    "PrivateMounts=yes",
    "PrivateNetwork=yes",
    "RemoveIPC=yes",
    "KillMode=control-group",
    "SendSIGKILL=yes",
    "TimeoutStopSec=5s",
    "RuntimeMaxSec=30s",
    "Restart=no",
    "TasksMax=64",
    "UMask=0077",
    "StandardOutput=null",
    "StandardError=null",
    `WorkingDirectory=${appRoot}`,
    bindProperty,
    `InaccessiblePaths=${controlDirectory}`,
    `LoadCredential=server-actions-key:${credentialPath}`,
  ];
  const startArgs = [
    "--non-interactive",
    "/usr/bin/systemd-run",
    "--quiet",
    "--collect",
    `--unit=${unit}`,
    "--service-type=exec",
    ...properties.map((value) => `--property=${value}`),
    ...Object.entries(runtimeEnvironment).map(([key, value]) => `--setenv=${key}=${value}`),
    "--",
    "/bin/sh",
    "-c",
    'export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(cat -- "$CREDENTIALS_DIRECTORY/server-actions-key")"; exec "$@"',
    "moawork-smoke",
    process.execPath,
    entrypoint,
  ];
  return runTransientSmokeService({ unit, startArgs, credentialPath, probe: async (initialControlGroup) => {
    let controlGroup = initialControlGroup;
    const deadline = Date.now() + 20_000;
    let lastError = null;
    while (Date.now() < deadline) {
      const mainPid = Number(await systemctlValue(unit, "MainPID"));
      if (!controlGroup) controlGroup = await systemctlValue(unit, "ControlGroup");
      try {
        await assertMainPidInControlGroup(mainPid, controlGroup);
        const { stdout } = await execFile("/usr/bin/sudo", [
          "--non-interactive",
          "/usr/bin/nsenter",
          "--target",
          String(mainPid),
          "--net",
          "/usr/bin/curl",
          "--silent",
          "--show-error",
          "--fail-with-body",
          "--noproxy",
          "*",
          "--max-time",
          "1",
          `http://127.0.0.1:${port}/api/health/live`,
        ], {
          encoding: "utf8",
          maxBuffer: 64 * 1024,
          timeout: 2_000,
          windowsHide: true,
        });
        const body = JSON.parse(stdout);
        await assertMainPidInControlGroup(mainPid, controlGroup);
        if (
          body?.runtime === "self-hosted"
          && body?.buildSha === descriptor.sourceSha
          && body?.artifactSha256 === descriptor.archiveSha256
          && body?.serverActions === "verified"
          && body?.serverActionsKeyFingerprint === descriptor.serverActionsKeyFingerprint
        ) {
          return Object.freeze({
            kind: "next-standalone-http-health-v1",
            platform: process.platform,
            arch: process.arch,
            nodeVersion: process.version,
            healthPath: "/api/health/live",
            sourceSha: descriptor.sourceSha,
            archiveSha256: descriptor.archiveSha256,
            serverActionsKeyFingerprint: descriptor.serverActionsKeyFingerprint,
          });
        }
        lastError = new Error("standalone health identity did not match the signed artifact");
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    fail("ABI_SMOKE", "standalone runtime did not pass native Linux health verification", lastError);
  } });
}

function validateRuntimeEvidence(evidence, descriptor) {
  exactKeys(evidence, RUNTIME_EVIDENCE_KEYS, "PROVENANCE_RUNTIME");
  if (
    evidence.kind !== "next-standalone-http-health-v1"
    || evidence.platform !== "linux"
    || evidence.arch !== descriptor.builder.arch
    || evidence.nodeVersion !== descriptor.builder.nodeVersion
    || evidence.healthPath !== "/api/health/live"
    || evidence.sourceSha !== descriptor.sourceSha
    || evidence.archiveSha256 !== descriptor.archiveSha256
    || evidence.serverActionsKeyFingerprint !== descriptor.serverActionsKeyFingerprint
  ) fail("PROVENANCE_RUNTIME", "signed native runtime evidence does not match the exact artifact");
  return evidence;
}

async function inspectReleaseArtifactRuntime({ archivePath, manifestPath, controlDirectory }) {
  const descriptor = await verifyReleaseArtifact({ archivePath, manifestPath });
  if (descriptor.builder.platform !== "linux") fail("BUILDER_PLATFORM", "artifact manifest must identify the native Linux builder");
  const inspectionRoot = await mkdtemp("/tmp/moawork-attest-");
  try {
    const releaseRoot = path.join(inspectionRoot, "release");
    await verifyReleaseArtifact({ archivePath, manifestPath, destinationPath: releaseRoot });
    const requiredServerFiles = JSON.parse(await readFile(path.join(releaseRoot, "runtime", "app", ".next", "required-server-files.json"), "utf8"));
    if (requiredServerFiles?.config?.deploymentId !== descriptor.sourceSha) {
      fail("BUILD_IDENTITY_MISMATCH", "signed standalone deployment identity must equal the exact source commit");
    }
    if (requiredServerFiles?.config?.env?.MOAWORK_SERVER_ACTIONS_BUILD_FINGERPRINT !== descriptor.serverActionsKeyFingerprint) {
      fail("SERVER_ACTIONS_BUILD_FINGERPRINT", "signed standalone key fingerprint differs from its manifest");
    }
    const serverReferenceManifest = JSON.parse(await readFile(
      path.join(releaseRoot, "runtime", "app", ".next", "server", "server-reference-manifest.json"),
      "utf8",
    ));
    if (serverActionsFingerprint(serverReferenceManifest?.encryptionKey) !== descriptor.serverActionsKeyFingerprint) {
      fail("SERVER_ACTIONS_BUILD_FINGERPRINT", "signed artifact was not built with the fingerprinted Server Actions key");
    }
    // Keep the host ancestor private (mkdtemp's 0700). Only systemd's privileged
    // bind setup traverses it; the DynamicUser sees the read-only service mount.
    await makeRuntimeTreeReadOnly(releaseRoot);
    return { descriptor, runtimeEvidence: await proveNativeLinuxRuntime({ releaseRoot, descriptor, controlDirectory }) };
  } catch (error) {
    if (error instanceof ArtifactContractError) throw error;
    fail("BUILD_IDENTITY", "signed standalone deployment identity is unavailable or malformed", error);
  } finally {
    await makeRuntimeTreeRemovable(inspectionRoot);
    await rm(inspectionRoot, { recursive: true, force: true });
  }
}

export async function produceReleaseArtifactSmokeEvidence({ archivePath, manifestPath, smokeEvidencePath }) {
  if (process.platform !== "linux") fail("BUILDER_PLATFORM", "runtime evidence may be produced only on native Linux");
  const control = await assertPrivateSmokeControlPaths({ archivePath, manifestPath, smokeEvidencePath });
  const { descriptor, runtimeEvidence } = await inspectReleaseArtifactRuntime({
    archivePath: control.archivePath,
    manifestPath: control.manifestPath,
    controlDirectory: path.dirname(control.archivePath),
  });
  const afterSmoke = await verifyReleaseArtifact({ archivePath: control.archivePath, manifestPath: control.manifestPath });
  if (canonicalJson(descriptorSubject(afterSmoke)) !== canonicalJson(descriptorSubject(descriptor))
    || canonicalJson(afterSmoke.builder) !== canonicalJson(descriptor.builder)) {
    fail("ABI_SANDBOX", "runtime smoke changed the artifact before evidence creation");
  }
  const evidence = releaseSmokeEvidenceEnvelope(descriptor, runtimeEvidence, protectedBuildEvidence(descriptor));
  const output = control.smokeEvidencePath;
  await writeFile(output, canonicalJson(evidence), { flag: "wx", mode: 0o600 });
  return Object.freeze({ smokeEvidencePath: output, smokeEvidenceSha256: sha256(canonicalJson(evidence)) });
}

export function releaseSmokeEvidenceEnvelope(descriptor, runtimeEvidence, buildEvidence) {
  return Object.freeze({
    schema: 1,
    subject: descriptorSubject(descriptor),
    builder: { ...descriptor.builder },
    runtimeEvidence: { ...runtimeEvidence },
    buildEvidence: { ...buildEvidence },
  });
}

export function validateReleaseSmokeEvidenceEnvelope(evidence, descriptor, signingEvidence) {
  exactKeys(evidence, SMOKE_EVIDENCE_KEYS, "PROVENANCE_RUNTIME");
  if (evidence.schema !== 1) fail("PROVENANCE_RUNTIME", "unsupported runtime smoke evidence schema");
  exactKeys(evidence.subject, SUBJECT_KEYS, "PROVENANCE_SUBJECT");
  exactKeys(evidence.builder, BUILDER_KEYS, "PROVENANCE_BUILDER");
  if (canonicalJson(evidence.subject) !== canonicalJson(descriptorSubject(descriptor))
    || canonicalJson(evidence.builder) !== canonicalJson(descriptor.builder)) {
    fail("PROVENANCE_SUBJECT", "runtime smoke evidence does not bind the exact artifact");
  }
  validateRuntimeEvidence(evidence.runtimeEvidence, descriptor);
  validateBuildEvidence(evidence.buildEvidence, descriptor, signingEvidence);
  return evidence;
}

async function readValidatedSmokeEvidence({ smokeEvidencePath, descriptor, signingEvidence }) {
  const evidenceFile = await requireRegularFile(smokeEvidencePath, "PROVENANCE_FILE", { maxBytes: MAX_SMOKE_EVIDENCE_BYTES });
  const raw = await readFile(evidenceFile);
  let evidence;
  try {
    evidence = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    fail("PROVENANCE_JSON", "runtime smoke evidence is not valid JSON", error);
  }
  if (!raw.equals(Buffer.from(canonicalJson(evidence)))) fail("PROVENANCE_CANONICAL", "runtime smoke evidence must use canonical JSON bytes");
  return validateReleaseSmokeEvidenceEnvelope(evidence, descriptor, signingEvidence);
}

export async function signReleaseArtifactAttestationFromEvidence({
  archivePath,
  manifestPath,
  smokeEvidencePath,
  privateKeyPath,
  attestationPath,
}) {
  if (process.platform !== "linux") fail("BUILDER_PLATFORM", "trusted release attestation may be signed only on native Linux");
  const privatePath = await requireRegularFile(privateKeyPath, "PROVENANCE_KEY");
  const descriptor = await verifyReleaseArtifact({ archivePath, manifestPath });
  if (descriptor.builder.platform !== "linux") fail("BUILDER_PLATFORM", "artifact manifest must identify the native Linux builder");
  const ciEvidence = protectedCiEvidence(descriptor);
  const smokeEvidence = await readValidatedSmokeEvidence({ smokeEvidencePath, descriptor, signingEvidence: ciEvidence });
  let privateKey;
  try {
    privateKey = createPrivateKey(await readFile(privatePath));
  } catch (error) {
    fail("PROVENANCE_KEY", "builder private key is invalid", error);
  }
  if (privateKey.asymmetricKeyType !== "ed25519") fail("PROVENANCE_KEY", "builder private key must be Ed25519");
  const publicKey = createPublicKey(privateKey);
  const statement = releaseProvenanceStatement(descriptor, smokeEvidence.runtimeEvidence, ciEvidence);
  const signature = signBytes(null, Buffer.from(canonicalJson(statement)), privateKey).toString("base64");
  const attestation = {
    schema: 1,
    statement,
    signature: { algorithm: "ed25519", keyId: publicKeyIdentity(publicKey), value: signature },
  };
  const output = path.resolve(attestationPath);
  await writeFile(output, canonicalJson(attestation), { flag: "wx", mode: 0o600 });
  return Object.freeze({ attestationPath: output, attestationSha256: sha256(canonicalJson(attestation)), keyId: attestation.signature.keyId });
}

export async function verifyTrustedReleaseArtifact({
  archivePath,
  manifestPath,
  attestationPath,
  trustedPublicKeyPath,
  destinationPath = null,
}) {
  // Signature trust is decided before any extraction destination is touched.
  const descriptor = await verifyReleaseArtifact({ archivePath, manifestPath });
  const attestationFile = await requireRegularFile(attestationPath, "PROVENANCE_FILE");
  const publicKeyFile = await requireRegularFile(trustedPublicKeyPath, "PROVENANCE_KEY");
  const raw = await readFile(attestationFile);
  let attestation;
  try {
    attestation = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    fail("PROVENANCE_JSON", "release attestation is not valid JSON", error);
  }
  if (!raw.equals(Buffer.from(canonicalJson(attestation)))) fail("PROVENANCE_CANONICAL", "release attestation must use canonical JSON bytes");
  exactKeys(attestation, ["schema", "signature", "statement"], "PROVENANCE_SCHEMA");
  if (attestation.schema !== 1) fail("PROVENANCE_SCHEMA", "unsupported release attestation schema");
  exactKeys(attestation.statement, STATEMENT_KEYS, "PROVENANCE_STATEMENT");
  exactKeys(attestation.statement.subject, SUBJECT_KEYS, "PROVENANCE_SUBJECT");
  exactKeys(attestation.statement.builder, BUILDER_KEYS, "PROVENANCE_BUILDER");
  validateRuntimeEvidence(attestation.statement.runtimeEvidence, descriptor);
  validateCiEvidence(attestation.statement.ciEvidence, descriptor);
  exactKeys(attestation.signature, SIGNATURE_KEYS, "PROVENANCE_SIGNATURE");
  const expectedStatement = releaseProvenanceStatement(
    descriptor,
    attestation.statement.runtimeEvidence,
    attestation.statement.ciEvidence,
  );
  if (canonicalJson(attestation.statement) !== canonicalJson(expectedStatement)) {
    fail("PROVENANCE_SUBJECT", "attestation does not bind the exact verified artifact and builder");
  }
  if (attestation.statement.builder.platform !== "linux") fail("BUILDER_PLATFORM", "production artifacts require a native Linux builder");
  if (attestation.signature.algorithm !== "ed25519" || !SHA64.test(attestation.signature.keyId ?? "")) {
    fail("PROVENANCE_SIGNATURE", "attestation signature identity is malformed");
  }
  const signatureText = attestation.signature.value;
  if (typeof signatureText !== "string" || !BASE64.test(signatureText) || Buffer.from(signatureText, "base64").toString("base64") !== signatureText) {
    fail("PROVENANCE_SIGNATURE", "attestation signature bytes are malformed");
  }
  let publicKey;
  try {
    publicKey = createPublicKey(await readFile(publicKeyFile));
  } catch (error) {
    fail("PROVENANCE_KEY", "trusted builder public key is invalid", error);
  }
  if (publicKeyIdentity(publicKey) !== attestation.signature.keyId) fail("PROVENANCE_KEY", "attestation signer is not the pinned trusted builder");
  if (!verifyBytes(null, Buffer.from(canonicalJson(attestation.statement)), publicKey, Buffer.from(signatureText, "base64"))) {
    fail("PROVENANCE_SIGNATURE", "release attestation signature is invalid");
  }
  if (destinationPath !== null) {
    await verifyReleaseArtifact({ archivePath, manifestPath, destinationPath });
  }
  return Object.freeze({
    ...descriptor,
    builder: Object.freeze({ ...descriptor.builder }),
    assurance: Object.freeze({
      transportIntegrityOnly: false,
      signed: true,
      builderTrustVerified: true,
      linuxAbiVerified: true,
    }),
    services: Object.freeze(descriptor.services.map((service) => Object.freeze({ ...service }))),
  });
}
