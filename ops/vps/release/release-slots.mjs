import path from "node:path";

const SHA40 = /^[0-9a-f]{40}$/u;
const SHA64 = /^[0-9a-f]{64}$/u;

export class ReleaseSlotError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "ReleaseSlotError";
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new ReleaseSlotError(code, message, cause === undefined ? {} : { cause });
}

function assertNonEmpty(value, label) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    fail("invalid_input", `${label} must be a non-empty canonical string`);
  }
}

function artifactIdentity(artifact) {
  return {
    releaseId: artifact.releaseId,
    sourceSha: artifact.sourceSha,
    sourceTree: artifact.sourceTree,
    serverActionsKeyFingerprint: artifact.serverActionsKeyFingerprint,
    archiveSha256: artifact.archiveSha256,
    manifestSha256: artifact.manifestSha256,
    builder: artifact.builder,
    assurance: artifact.assurance,
    services: artifact.services.map(({ serviceKey, payloadRoot }) => ({ serviceKey, payloadRoot })),
  };
}

function exactObjectKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function validateArtifactDescriptor(artifact, { code, expectedSourceSha = null }) {
  if (!artifact || typeof artifact !== "object" || artifact.schema !== 1) {
    fail(code, "release artifact descriptor did not return schema 1");
  }
  if (!SHA64.test(artifact.releaseId) || artifact.releaseId !== artifact.archiveSha256) {
    fail(code, "release identity must equal the verified archive SHA-256");
  }
  if (!SHA40.test(artifact.sourceSha) || !SHA40.test(artifact.sourceTree)) {
    fail(code, "artifact source identity is malformed");
  }
  if (!SHA64.test(artifact.serverActionsKeyFingerprint ?? "")) {
    fail(code, "artifact Server Actions build fingerprint is malformed");
  }
  if (
    !exactObjectKeys(artifact.builder, ["arch", "nodeVersion", "npmVersion", "platform"])
    || typeof artifact.builder.arch !== "string"
    || typeof artifact.builder.nodeVersion !== "string"
    || typeof artifact.builder.npmVersion !== "string"
    || typeof artifact.builder.platform !== "string"
    || !exactObjectKeys(artifact.assurance, ["builderTrustVerified", "linuxAbiVerified", "signed", "transportIntegrityOnly"])
    || typeof artifact.assurance.builderTrustVerified !== "boolean"
    || typeof artifact.assurance.linuxAbiVerified !== "boolean"
    || typeof artifact.assurance.signed !== "boolean"
    || typeof artifact.assurance.transportIntegrityOnly !== "boolean"
  ) fail(code, "artifact builder assurance is malformed");
  if (expectedSourceSha !== null && artifact.sourceSha !== expectedSourceSha) {
    fail("artifact_mismatch", "artifact source commit differs from the requested release");
  }
  if (!SHA64.test(artifact.archiveSha256) || !SHA64.test(artifact.manifestSha256)) {
    fail(code, "artifact digests are malformed");
  }
  if (!path.isAbsolute(artifact.archivePath) || !path.isAbsolute(artifact.manifestPath)) {
    fail(code, "artifact descriptor paths must be absolute");
  }
  if (
    !Array.isArray(artifact.services)
    || artifact.services.length !== 1
    || artifact.services[0]?.serviceKey !== "web"
    || artifact.services[0]?.payloadRoot !== "runtime"
  ) {
    fail(code, "release slots accept the verified web/runtime service only");
  }
  return Object.freeze({
    ...artifact,
    builder: Object.freeze({ ...artifact.builder }),
    assurance: Object.freeze({ ...artifact.assurance }),
    services: Object.freeze(artifact.services.map((service) => Object.freeze({ ...service }))),
  });
}

function validateExpectedBuilder(value) {
  if (value === null) return null;
  if (
    !exactObjectKeys(value, ["arch", "nodeVersion", "platform"])
    || value.platform !== "linux"
    || typeof value.arch !== "string"
    || value.arch.length === 0
    || typeof value.nodeVersion !== "string"
    || !/^v[0-9]+[.][0-9]+[.][0-9]+$/u.test(value.nodeVersion)
  ) fail("invalid_input", "expected builder identity is malformed");
  return Object.freeze({ ...value });
}

function validateVerifiedArtifact(artifact, expectedSourceSha, expectedBuilder) {
  const verified = validateArtifactDescriptor(artifact, { code: "artifact_invalid", expectedSourceSha });
  if (
    verified.builder.platform !== "linux"
    || verified.assurance.builderTrustVerified !== true
    || verified.assurance.linuxAbiVerified !== true
    || verified.assurance.signed !== true
    || verified.assurance.transportIntegrityOnly !== false
  ) fail("artifact_untrusted", "production release requires signed trusted Linux artifact provenance");
  if (expectedBuilder !== null && (
    verified.builder.platform !== expectedBuilder.platform
    || verified.builder.arch !== expectedBuilder.arch
    || verified.builder.nodeVersion !== expectedBuilder.nodeVersion
  )) fail("artifact_untrusted", "artifact builder identity differs from the audited target runtime");
  return verified;
}

function identitiesEqual(left, right) {
  if (
    !left
    || typeof left !== "object"
    || !Array.isArray(left.services)
    || !right
    || typeof right !== "object"
    || !Array.isArray(right.services)
  ) return false;
  return JSON.stringify(artifactIdentity(left)) === JSON.stringify(artifactIdentity(right));
}

// 최초 공개 전환(버셀→VPS)은 끝났고 그 명령들은 제거했다. 옛 상태 파일에 마커가
// 남아 있으면 조용히 무시하지 않고 멈춘다 — 그걸 확정하거나 취소할 명령이 더는 없다.
function validateNoRecovery(value) {
  if (value === null || value === undefined) return null;
  fail("status_invalid", "release recovery markers are no longer supported");
}

function validateStatus(status, slotIds) {
  if (!status || typeof status !== "object" || !Number.isSafeInteger(status.generation) || status.generation < 0) {
    fail("status_invalid", "release status generation is invalid");
  }
  for (const key of ["activeSlot", "previousSlot"]) {
    const value = status[key];
    if (value !== null && !slotIds.includes(value)) fail("status_invalid", `${key} is outside the release slots`);
  }
  if (status.activeSlot !== null && status.activeSlot === status.previousSlot) {
    fail("status_invalid", "active and previous slots must differ");
  }
  if (!status.slots || typeof status.slots !== "object" || Array.isArray(status.slots)) {
    fail("status_invalid", "release status must contain the exact slot records");
  }
  const storedSlotIds = Object.keys(status.slots).sort();
  if (JSON.stringify(storedSlotIds) !== JSON.stringify([...slotIds].sort())) {
    fail("status_invalid", "release status slot records do not match the configured slots");
  }
  const slots = {};
  for (const slot of slotIds) {
    const record = status.slots[slot];
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      fail("status_invalid", "release status contains a malformed slot record");
    }
    slots[slot] = Object.freeze({
      ...record,
      artifact: record.artifact === null
        ? null
        : validateArtifactDescriptor(record.artifact, { code: "status_invalid" }),
    });
  }
  for (const slot of [status.activeSlot, status.previousSlot]) {
    if (slot !== null && slots[slot].artifact === null) {
      fail("status_invalid", "active and previous slots require a canonical artifact identity");
    }
  }
  const recovery = validateNoRecovery(status.recovery);
  return Object.freeze({ ...status, recovery, slots: Object.freeze(slots) });
}

function candidateSlot(status, slotIds) {
  return status.activeSlot === null ? slotIds[0] : slotIds.find((slot) => slot !== status.activeSlot);
}

function exactHealth(result, artifact) {
  return result?.ok === true
    && result.releaseId === artifact.releaseId
    && result.sourceSha === artifact.sourceSha
    && result.serverActionsKeyFingerprint === artifact.serverActionsKeyFingerprint;
}

async function bounded(label, timeoutMs, operation) {
  const controller = new AbortController();
  let timedOut = false;
  let timeout;
  const timeoutResult = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      const error = new ReleaseSlotError("timeout", `${label} exceeded its bounded timeout`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), timeoutResult]);
  } catch (error) {
    if (error instanceof ReleaseSlotError && error.code === "timeout") throw error;
    if (timedOut || controller.signal.aborted) {
      fail("timeout", `${label} exceeded its bounded timeout`, error);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function validateSwitch(result, expected) {
  if (
    !result
    || result.activeSlot !== expected.activeSlot
    || result.previousSlot !== expected.previousSlot
    || result.generation !== expected.generation
  ) {
    fail("switch_mismatch", "atomic switch returned an unexpected status");
  }
  return result;
}

function switchStateMatches(status, expected) {
  return status.activeSlot === expected.activeSlot
    && status.previousSlot === expected.previousSlot
    && status.generation === expected.generation;
}

export function createReleaseSlots({ verifyReleaseArtifact, runtime, slotIds, timeoutMs, expectedBuilder = null }) {
  if (typeof verifyReleaseArtifact !== "function") fail("invalid_input", "artifact verifier is required");
  if (!runtime || typeof runtime !== "object") fail("invalid_input", "release runtime is required");
  if (!Array.isArray(slotIds) || slotIds.length !== 2 || new Set(slotIds).size !== 2) {
    fail("invalid_input", "exactly two distinct release slots are required");
  }
  slotIds.forEach((slot, index) => assertNonEmpty(slot, `slotIds[${index}]`));
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) fail("invalid_input", "a positive bounded timeout is required");
  const reviewedBuilder = validateExpectedBuilder(expectedBuilder);

  const call = (label, method, input) => {
    if (typeof runtime[method] !== "function") fail("invalid_input", `runtime.${method} is required`);
    return bounded(label, timeoutMs, (signal) => runtime[method]({ ...input, signal }));
  };

  async function status() {
    return validateStatus(await call("status", "status", {}), slotIds);
  }

  async function switchWithReconciliation({ label, input, before, expected }) {
    try {
      return validateSwitch(await call(label, "switchActive", input), expected);
    } catch (error) {
      let authoritative;
      try {
        authoritative = await status();
      } catch (statusError) {
        fail("switch_unknown", `${label} outcome and authoritative status are unknown`, statusError);
      }
      if (switchStateMatches(authoritative, expected)) return authoritative;
      if (switchStateMatches(authoritative, before) && error?.code !== "timeout") {
        fail("switch_failed", `${label} was not committed`, error);
      }
      fail("switch_unknown", `${label} outcome is ambiguous and requires reconciliation`, error);
    }
  }

  async function verifyDeployArtifact({ archivePath, manifestPath, attestationPath = null, expectedSourceSha }) {
    if (!SHA40.test(expectedSourceSha ?? "")) fail("invalid_input", "expected source commit is required");
    return validateVerifiedArtifact(
      await bounded("artifact verification", timeoutMs, (signal) => verifyReleaseArtifact({ archivePath, manifestPath, attestationPath, signal })),
      expectedSourceSha,
      reviewedBuilder,
    );
  }

  async function deploy({ mode, archivePath, manifestPath, attestationPath = null, expectedSourceSha }) {
    if (mode !== "shadow" && mode !== "activate") fail("invalid_input", "mode must be shadow or activate");
    const artifact = await verifyDeployArtifact({ archivePath, manifestPath, attestationPath, expectedSourceSha });
    const before = await status();
    const targetSlot = candidateSlot(before, slotIds);
    if (!targetSlot) fail("status_invalid", "no inactive release slot is available");
    const previousArtifact = before.activeSlot === null ? null : before.slots[before.activeSlot].artifact;
    if (mode === "activate" && before.activeSlot === null) {
      fail("rollback_unavailable", "activation requires a healthy previous slot for rollback");
    }

    const prepared = await call("candidate prepare", "prepare", { slot: targetSlot, artifact });
    if (prepared?.slot !== targetSlot || !identitiesEqual(prepared.artifact, artifact)) {
      fail("prepare_mismatch", "prepared slot does not match the verified artifact");
    }
    const verified = await call("prepared release verification", "verifyPrepared", { slot: targetSlot, artifact });
    if (verified?.slot !== targetSlot || !identitiesEqual(verified.artifact, artifact)) {
      fail("prepare_mismatch", "prepared release verification returned a different artifact");
    }
    await call("candidate start", "startCandidate", { slot: targetSlot, artifact });
    let candidateHealth;
    try {
      candidateHealth = await call("candidate health", "checkCandidate", { slot: targetSlot, artifact });
    } catch (error) {
      await call("candidate reject", "rejectCandidate", { slot: targetSlot, artifact });
      throw error;
    }
    if (!exactHealth(candidateHealth, artifact)) {
      await call("candidate reject", "rejectCandidate", { slot: targetSlot, artifact });
      fail("candidate_unhealthy", "candidate health did not prove the requested release identity");
    }

    if (mode === "shadow") {
      return { mode, artifact: artifactIdentity(artifact), targetSlot, switched: false, status: await status() };
    }

    const switched = await switchWithReconciliation({
      label: "atomic switch",
      input: {
        expectedActiveSlot: before.activeSlot,
        expectedGeneration: before.generation,
        targetSlot,
        artifact,
      },
      before: {
        activeSlot: before.activeSlot,
        previousSlot: before.previousSlot,
        generation: before.generation,
      },
      expected: { activeSlot: targetSlot, previousSlot: before.activeSlot, generation: before.generation + 1 },
    });
    let publicFailure = null;
    let publicHealth = null;
    try {
      publicHealth = await call("public health", "checkPublic", { artifact });
    } catch (error) {
      publicFailure = error;
    }
    if (publicFailure === null && exactHealth(publicHealth, artifact)) {
      return { mode, artifact: artifactIdentity(artifact), targetSlot, switched: true, status: await status() };
    }

    try {
      await switchWithReconciliation({
        label: "automatic rollback",
        input: {
          expectedActiveSlot: targetSlot,
          expectedGeneration: switched.generation,
          targetSlot: before.activeSlot,
          artifact: previousArtifact,
        },
        before: {
          activeSlot: switched.activeSlot,
          previousSlot: switched.previousSlot,
          generation: switched.generation,
        },
        expected: { activeSlot: before.activeSlot, previousSlot: targetSlot, generation: switched.generation + 1 },
      });
      const rollbackHealth = await call("rollback public health", "checkPublic", { artifact: previousArtifact });
      if (!exactHealth(rollbackHealth, previousArtifact)) fail("rollback_failed", "rollback did not restore public health");
    } catch (error) {
      if (error instanceof ReleaseSlotError && error.code === "rollback_failed") throw error;
      fail("rollback_failed", "automatic rollback could not restore the previous release", error);
    }
    fail(
      "public_unhealthy",
      "candidate public health was not proven and the previous release was restored",
      publicFailure ?? undefined,
    );
  }

  async function rollback() {
    const before = await status();
    if (before.activeSlot === null || before.previousSlot === null) {
      fail("rollback_unavailable", "active and previous release slots are required");
    }
    const previousArtifact = before.slots[before.previousSlot].artifact;
    const candidateHealth = await call("rollback candidate health", "checkCandidate", {
      slot: before.previousSlot,
      artifact: previousArtifact,
    });
    if (!exactHealth(candidateHealth, previousArtifact)) {
      fail("rollback_unavailable", "previous release is not healthy enough to activate");
    }
    await switchWithReconciliation({
      label: "atomic rollback",
      input: {
        expectedActiveSlot: before.activeSlot,
        expectedGeneration: before.generation,
        targetSlot: before.previousSlot,
        artifact: previousArtifact,
      },
      before: {
        activeSlot: before.activeSlot,
        previousSlot: before.previousSlot,
        generation: before.generation,
      },
      expected: { activeSlot: before.previousSlot, previousSlot: before.activeSlot, generation: before.generation + 1 },
    });
    const publicHealth = await call("rollback public health", "checkPublic", { artifact: previousArtifact });
    if (!exactHealth(publicHealth, previousArtifact)) fail("rollback_failed", "rollback switched but public health failed");
    return { artifact: artifactIdentity(previousArtifact), status: await status() };
  }

  return Object.freeze({
    deploy,
    rollback,
    status,
    verifyDeployArtifact,
  });
}
