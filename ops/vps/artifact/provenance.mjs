import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { ArtifactContractError, verifyReleaseArtifact } from "./contract.mjs";

const SHA64 = /^[0-9a-f]{64}$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const STATEMENT_KEYS = ["builder", "ciEvidence", "predicateType", "runtimeEvidence", "schema", "subject"];
const SUBJECT_KEYS = ["archiveSha256", "manifestSha256", "serverActionsKeyFingerprint", "sourceSha", "sourceTree"];
const BUILDER_KEYS = ["arch", "nodeVersion", "npmVersion", "platform"];
const RUNTIME_EVIDENCE_KEYS = ["arch", "archiveSha256", "healthPath", "kind", "nodeVersion", "platform", "serverActionsKeyFingerprint", "sourceSha"];
const CI_EVIDENCE_KEYS = ["eventName", "job", "ref", "repository", "runAttempt", "runId", "runnerArch", "runnerOs", "sha", "workflowRef"];
const SIGNATURE_KEYS = ["algorithm", "keyId", "value"];

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

async function requireRegularFile(value, code) {
  const resolved = path.resolve(value);
  const stats = await lstat(resolved).catch((error) => fail(code, "provenance input is unavailable", error));
  if (!stats.isFile() || stats.isSymbolicLink()) fail(code, "provenance inputs must be regular non-symlink files");
  return resolved;
}

function publicKeyIdentity(publicKey) {
  if (publicKey.asymmetricKeyType !== "ed25519") fail("PROVENANCE_KEY", "trusted builder key must be Ed25519");
  return sha256(publicKey.export({ type: "spki", format: "der" }));
}

export function releaseProvenanceStatement(descriptor, runtimeEvidence, ciEvidence) {
  return {
    schema: 1,
    predicateType: "moawork.trusted-linux-next-standalone/v1",
    subject: {
      sourceSha: descriptor.sourceSha,
      sourceTree: descriptor.sourceTree,
      archiveSha256: descriptor.archiveSha256,
      manifestSha256: descriptor.manifestSha256,
      serverActionsKeyFingerprint: descriptor.serverActionsKeyFingerprint,
    },
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

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function proveNativeLinuxRuntime({ releaseRoot, descriptor }) {
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
  const appRoot = path.join(releaseRoot, "runtime", "app");
  const entrypoint = path.join(appRoot, "server.js");
  await requireRegularFile(entrypoint, "ABI_SMOKE");
  const port = await reserveLoopbackPort();
  const child = spawn(process.execPath, [entrypoint], {
    cwd: appRoot,
    env: {
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      MOAWORK_BUILD_SHA: descriptor.sourceSha,
      MOAWORK_RELEASE_SHA: descriptor.sourceSha,
      MOAWORK_ARTIFACT_SHA256: descriptor.archiveSha256,
      NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: runtimeKey,
    },
    stdio: "ignore",
    windowsHide: true,
  });
  try {
    const deadline = Date.now() + 20_000;
    let lastError = null;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        fail("ABI_SMOKE", "standalone runtime exited before native health verification");
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health/live`, {
          signal: AbortSignal.timeout(750),
          headers: { Accept: "application/json" },
        });
        const body = await response.json();
        if (
          response.status === 200
          && body?.runtime === "self-hosted"
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
  } finally {
    await stopChild(child);
  }
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

export async function signReleaseArtifactAttestation({
  archivePath,
  manifestPath,
  privateKeyPath,
  attestationPath,
}) {
  if (process.platform !== "linux") fail("BUILDER_PLATFORM", "trusted release attestation may be signed only on native Linux");
  const privatePath = await requireRegularFile(privateKeyPath, "PROVENANCE_KEY");
  const descriptor = await verifyReleaseArtifact({ archivePath, manifestPath });
  if (descriptor.builder.platform !== "linux") fail("BUILDER_PLATFORM", "artifact manifest must identify the native Linux builder");
  const inspectionRoot = await mkdtemp(path.join(os.tmpdir(), "moawork-attest-"));
  let runtimeEvidence;
  try {
    const releaseRoot = path.join(inspectionRoot, "release");
    await verifyReleaseArtifact({ archivePath, manifestPath, destinationPath: releaseRoot });
    const requiredServerFiles = JSON.parse(await readFile(path.join(releaseRoot, "runtime", "app", ".next", "required-server-files.json"), "utf8"));
    if (requiredServerFiles?.config?.deploymentId !== descriptor.sourceSha) {
      fail("BUILD_IDENTITY_MISMATCH", "signed standalone deployment identity must equal the exact source commit");
    }
    if (
      requiredServerFiles?.config?.env?.MOAWORK_SERVER_ACTIONS_BUILD_FINGERPRINT
      !== descriptor.serverActionsKeyFingerprint
    ) fail("SERVER_ACTIONS_BUILD_FINGERPRINT", "signed standalone key fingerprint differs from its manifest");
    const serverReferenceManifest = JSON.parse(await readFile(
      path.join(releaseRoot, "runtime", "app", ".next", "server", "server-reference-manifest.json"),
      "utf8",
    ));
    if (serverActionsFingerprint(serverReferenceManifest?.encryptionKey) !== descriptor.serverActionsKeyFingerprint) {
      fail("SERVER_ACTIONS_BUILD_FINGERPRINT", "signed artifact was not built with the fingerprinted Server Actions key");
    }
    runtimeEvidence = await proveNativeLinuxRuntime({ releaseRoot, descriptor });
  } catch (error) {
    if (error instanceof ArtifactContractError) throw error;
    fail("BUILD_IDENTITY", "signed standalone deployment identity is unavailable or malformed", error);
  } finally {
    await rm(inspectionRoot, { recursive: true, force: true });
  }
  const ciEvidence = protectedCiEvidence(descriptor);
  let privateKey;
  try {
    privateKey = createPrivateKey(await readFile(privatePath));
  } catch (error) {
    fail("PROVENANCE_KEY", "builder private key is invalid", error);
  }
  if (privateKey.asymmetricKeyType !== "ed25519") fail("PROVENANCE_KEY", "builder private key must be Ed25519");
  const publicKey = createPublicKey(privateKey);
  const statement = releaseProvenanceStatement(descriptor, runtimeEvidence, ciEvidence);
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
