import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFakeReleaseRuntime } from "./fake-release-runtime.mjs";
import { artifactContractUrl, createProductionReleaseSlots } from "./production-release.mjs";
import { createReleaseSlots, ReleaseSlotError } from "./release-slots.mjs";

const slots = ["release-a", "release-b"];
const sha = (digit, length) => digit.repeat(length);

// 정지(hang) 감시용 상한 — 성능 임계값이 아니다. 근거는
// linux-release-runtime.test.mjs 의 같은 이름 상수 주석 참조 (2026-09-14 flaky 제거).
const HANG_GUARD_MS = 60_000;

function artifact(digit) {
  const archiveSha256 = sha(digit, 64);
  return {
    schema: 1,
    releaseId: archiveSha256,
    sourceSha: sha(digit, 40),
    sourceTree: sha(digit === "a" ? "b" : "c", 40),
    serverActionsKeyFingerprint: sha("9", 64),
    archivePath: path.join(os.tmpdir(), `artifact-${digit}.tar`),
    archiveSha256,
    manifestPath: path.join(os.tmpdir(), `artifact-${digit}.json`),
    manifestSha256: sha(digit === "a" ? "c" : "d", 64),
    builder: { platform: "linux", arch: "x64", nodeVersion: "v22.0.0", npmVersion: "10.0.0" },
    assurance: { transportIntegrityOnly: false, signed: true, builderTrustVerified: true, linuxAbiVerified: true },
    services: [{ serviceKey: "web", payloadRoot: "runtime" }],
  };
}

function harness({ failures, stalls } = {}) {
  const oldArtifact = artifact("a");
  const nextArtifact = artifact("d");
  const runtime = createFakeReleaseRuntime({
    slotIds: slots,
    active: { slot: slots[0], artifact: oldArtifact },
    failures,
    stalls,
  });
  const verifierCalls = [];
  const controller = createReleaseSlots({
    slotIds: slots,
    timeoutMs: 25,
    runtime,
    verifyReleaseArtifact: async (input) => {
      verifierCalls.push(input);
      return nextArtifact;
    },
  });
  return { controller, runtime, oldArtifact, nextArtifact, verifierCalls };
}

function emptyHarness({ failures, stalls } = {}) {
  const nextArtifact = artifact("d");
  const runtime = createFakeReleaseRuntime({ slotIds: slots, failures, stalls });
  const controller = createReleaseSlots({
    slotIds: slots,
    timeoutMs: 25,
    runtime,
    verifyReleaseArtifact: async () => nextArtifact,
  });
  const identity = {
    targetSlot: slots[0],
    sourceSha: nextArtifact.sourceSha,
    artifactSha256: nextArtifact.releaseId,
  };
  return { controller, runtime, nextArtifact, identity };
}

async function prepareShadow(h) {
  return h.controller.deploy({
    mode: "shadow",
    archivePath: h.nextArtifact.archivePath,
    manifestPath: h.nextArtifact.manifestPath,
    expectedSourceSha: h.nextArtifact.sourceSha,
  });
}

test("private shadow prepares and verifies the inactive slot without switching the live release", async () => {
  const h = harness();
  const result = await h.controller.deploy({
    mode: "shadow",
    archivePath: h.nextArtifact.archivePath,
    manifestPath: h.nextArtifact.manifestPath,
    expectedSourceSha: h.nextArtifact.sourceSha,
  });

  assert.equal(result.switched, false);
  assert.equal(result.targetSlot, slots[1]);
  assert.equal(result.status.activeSlot, slots[0]);
  assert.equal(result.status.slots[slots[0]].artifact.releaseId, h.oldArtifact.releaseId);
  assert.equal(result.status.slots[slots[1]].artifact.releaseId, h.nextArtifact.releaseId);
  assert.deepEqual(h.runtime.events.map((event) => event.name), [
    "status", "prepare", "verifyPrepared", "startCandidate", "checkCandidate", "status",
  ]);
  assert.equal(h.verifierCalls.length, 1);
  assert.deepEqual([...h.runtime.touchedServices], ["web"]);
});

test("activation switches only after candidate health and public identity both pass", async () => {
  const h = harness();
  const result = await h.controller.deploy({
    mode: "activate",
    archivePath: h.nextArtifact.archivePath,
    manifestPath: h.nextArtifact.manifestPath,
    expectedSourceSha: h.nextArtifact.sourceSha,
  });

  assert.equal(result.switched, true);
  assert.equal(result.status.activeSlot, slots[1]);
  assert.equal(result.status.previousSlot, slots[0]);
  assert.equal(result.status.generation, 1);
  assert.ok(
    h.runtime.events.findIndex((event) => event.name === "checkCandidate")
      < h.runtime.events.findIndex((event) => event.name === "switchActive"),
  );
  assert.ok(
    h.runtime.events.findIndex((event) => event.name === "switchActive")
      < h.runtime.events.findIndex((event) => event.name === "checkPublic"),
  );
});

test("commit-then-response-loss reconciles the switch and still proves public health", async () => {
  const h = harness();
  const originalSwitch = h.runtime.switchActive.bind(h.runtime);
  let calls = 0;
  h.runtime.switchActive = async (input) => {
    calls += 1;
    const committed = await originalSwitch(input);
    if (calls === 1) throw new Error("switch response lost");
    return committed;
  };
  const result = await h.controller.deploy({
    mode: "activate",
    archivePath: h.nextArtifact.archivePath,
    manifestPath: h.nextArtifact.manifestPath,
    expectedSourceSha: h.nextArtifact.sourceSha,
  });
  assert.equal(result.status.activeSlot, slots[1]);
  assert.equal(result.status.generation, 1);
  assert.equal(calls, 1);
  assert.equal(h.runtime.events.filter((event) => event.name === "checkPublic").length, 1);
});

test("commit-then-timeout reconciles before public failure rolls back", async () => {
  const h = harness({ failures: { publicHealth: [true, false] } });
  const originalSwitch = h.runtime.switchActive.bind(h.runtime);
  let calls = 0;
  h.runtime.switchActive = async (input) => {
    calls += 1;
    const committed = await originalSwitch(input);
    if (calls === 1) return new Promise(() => {});
    return committed;
  };
  await assert.rejects(
    h.controller.deploy({
      mode: "activate",
      archivePath: h.nextArtifact.archivePath,
      manifestPath: h.nextArtifact.manifestPath,
      expectedSourceSha: h.nextArtifact.sourceSha,
    }),
    (error) => error instanceof ReleaseSlotError && error.code === "public_unhealthy",
  );
  const status = await h.controller.status();
  assert.equal(status.activeSlot, slots[0]);
  assert.equal(status.generation, 2);
  assert.equal(calls, 2);
});

test("definitive switch failure keeps the old release and does not check public health", async () => {
  const h = harness({ failures: { switchActive: true } });
  await assert.rejects(
    h.controller.deploy({
      mode: "activate",
      archivePath: h.nextArtifact.archivePath,
      manifestPath: h.nextArtifact.manifestPath,
      expectedSourceSha: h.nextArtifact.sourceSha,
    }),
    (error) => error instanceof ReleaseSlotError && error.code === "switch_failed",
  );
  const status = await h.controller.status();
  assert.equal(status.activeSlot, slots[0]);
  assert.equal(status.generation, 0);
  assert.equal(h.runtime.events.some((event) => event.name === "checkPublic"), false);
});

test("candidate health failure keeps the previous release active and never switches", async () => {
  const h = harness({ failures: { candidateHealth: true } });
  await assert.rejects(
    h.controller.deploy({
      mode: "activate",
      archivePath: h.nextArtifact.archivePath,
      manifestPath: h.nextArtifact.manifestPath,
      expectedSourceSha: h.nextArtifact.sourceSha,
    }),
    (error) => error instanceof ReleaseSlotError && error.code === "candidate_unhealthy",
  );
  const status = await h.controller.status();
  assert.equal(status.activeSlot, slots[0]);
  assert.equal(status.generation, 0);
  assert.equal(h.runtime.events.some((event) => event.name === "switchActive"), false);
});

test("public failure rolls traffic back to the exact previous release and reports failure", async () => {
  const h = harness({ failures: { publicHealth: [true, false] } });
  await assert.rejects(
    h.controller.deploy({
      mode: "activate",
      archivePath: h.nextArtifact.archivePath,
      manifestPath: h.nextArtifact.manifestPath,
      expectedSourceSha: h.nextArtifact.sourceSha,
    }),
    (error) => error instanceof ReleaseSlotError && error.code === "public_unhealthy",
  );
  const status = await h.controller.status();
  assert.equal(status.activeSlot, slots[0]);
  assert.equal(status.previousSlot, slots[1]);
  assert.equal(status.generation, 2);
  assert.equal(status.slots[slots[0]].artifact.releaseId, h.oldArtifact.releaseId);
});

test("public health transport error is an unknown outcome and restores the previous release", async () => {
  const h = harness();
  const originalCheckPublic = h.runtime.checkPublic.bind(h.runtime);
  let calls = 0;
  h.runtime.checkPublic = async (input) => {
    calls += 1;
    if (calls === 1) throw new Error("public transport failed");
    return originalCheckPublic(input);
  };
  await assert.rejects(
    h.controller.deploy({
      mode: "activate",
      archivePath: h.nextArtifact.archivePath,
      manifestPath: h.nextArtifact.manifestPath,
      expectedSourceSha: h.nextArtifact.sourceSha,
    }),
    (error) => error instanceof ReleaseSlotError
      && error.code === "public_unhealthy"
      && error.cause?.message === "public transport failed",
  );
  const status = await h.controller.status();
  assert.equal(status.activeSlot, slots[0]);
  assert.equal(status.generation, 2);
});

test("rollback failure is terminal and never converted into a success", async () => {
  const h = harness({ failures: { publicHealth: true } });
  const originalSwitch = h.runtime.switchActive.bind(h.runtime);
  let calls = 0;
  h.runtime.switchActive = async (input) => {
    calls += 1;
    if (calls === 2) throw new Error("rollback transport failed");
    return originalSwitch(input);
  };
  await assert.rejects(
    h.controller.deploy({
      mode: "activate",
      archivePath: h.nextArtifact.archivePath,
      manifestPath: h.nextArtifact.manifestPath,
      expectedSourceSha: h.nextArtifact.sourceSha,
    }),
    (error) => error instanceof ReleaseSlotError && error.code === "rollback_failed",
  );
});

test("explicit rollback health-checks the prior slot before the atomic switch", async () => {
  const h = harness();
  await h.controller.deploy({
    mode: "activate",
    archivePath: h.nextArtifact.archivePath,
    manifestPath: h.nextArtifact.manifestPath,
    expectedSourceSha: h.nextArtifact.sourceSha,
  });
  const rolledBack = await h.controller.rollback();
  assert.equal(rolledBack.status.activeSlot, slots[0]);
  assert.equal(rolledBack.status.previousSlot, slots[1]);
  const tail = h.runtime.events.slice(-4).map((event) => event.name);
  assert.deepEqual(tail, ["checkCandidate", "switchActive", "checkPublic", "status"]);
});

test("artifact mismatch and prepared identity drift fail closed before candidate start", async () => {
  const sourceMismatch = harness();
  await assert.rejects(
    sourceMismatch.controller.deploy({
      mode: "shadow",
      archivePath: sourceMismatch.nextArtifact.archivePath,
      manifestPath: sourceMismatch.nextArtifact.manifestPath,
      expectedSourceSha: sha("e", 40),
    }),
    (error) => error instanceof ReleaseSlotError && error.code === "artifact_mismatch",
  );
  assert.equal(sourceMismatch.runtime.events.length, 0);

  const preparedMismatch = harness({ failures: { verifyPrepared: true } });
  await assert.rejects(
    preparedMismatch.controller.deploy({
      mode: "shadow",
      archivePath: preparedMismatch.nextArtifact.archivePath,
      manifestPath: preparedMismatch.nextArtifact.manifestPath,
      expectedSourceSha: preparedMismatch.nextArtifact.sourceSha,
    }),
    (error) => error instanceof ReleaseSlotError && error.code === "prepare_mismatch",
  );
  assert.equal(preparedMismatch.runtime.events.some((event) => event.name === "startCandidate"), false);
});

test("transport-only or caller-asserted artifact assurance never reaches the runtime", async () => {
  const h = harness();
  const controller = createReleaseSlots({
    slotIds: slots,
    timeoutMs: 25,
    runtime: h.runtime,
    verifyReleaseArtifact: async () => ({
      ...h.nextArtifact,
      assurance: { transportIntegrityOnly: true, signed: false, builderTrustVerified: false, linuxAbiVerified: false },
    }),
  });
  await assert.rejects(
    controller.deploy({
      mode: "shadow",
      archivePath: h.nextArtifact.archivePath,
      manifestPath: h.nextArtifact.manifestPath,
      expectedSourceSha: h.nextArtifact.sourceSha,
    }),
    (error) => error instanceof ReleaseSlotError && error.code === "artifact_untrusted",
  );
  assert.deepEqual(h.runtime.events, []);
});

test("audited target builder identity rejects a trusted artifact before runtime access", async () => {
  const h = harness();
  const controller = createReleaseSlots({
    slotIds: slots,
    timeoutMs: 25,
    runtime: h.runtime,
    expectedBuilder: { platform: "linux", arch: "arm64", nodeVersion: "v22.23.2" },
    verifyReleaseArtifact: async () => h.nextArtifact,
  });
  await assert.rejects(
    controller.verifyDeployArtifact({
      archivePath: h.nextArtifact.archivePath,
      manifestPath: h.nextArtifact.manifestPath,
      expectedSourceSha: h.nextArtifact.sourceSha,
    }),
    (error) => error instanceof ReleaseSlotError && error.code === "artifact_untrusted",
  );
  assert.deepEqual(h.runtime.events, []);
});

test("stub verifier rejection stops before every runtime operation", async () => {
  const h = harness();
  const controller = createReleaseSlots({
    slotIds: slots,
    timeoutMs: 25,
    runtime: h.runtime,
    verifyReleaseArtifact: async () => {
      throw new Error("verification failed");
    },
  });
  await assert.rejects(
    controller.deploy({
      mode: "activate",
      archivePath: h.nextArtifact.archivePath,
      manifestPath: h.nextArtifact.manifestPath,
      expectedSourceSha: h.nextArtifact.sourceSha,
    }),
    /verification failed/u,
  );
  assert.deepEqual(h.runtime.events, []);
  assert.deepEqual([...h.runtime.touchedServices], []);
});

test("production entry binds the DG01 artifact contract and forbids verifier injection", async () => {
  assert.equal(
    path.normalize(artifactContractUrl.pathname).endsWith(path.normalize("/ops/vps/artifact/provenance.mjs")),
    true,
  );
  await assert.rejects(
    createProductionReleaseSlots({
      slotIds: slots,
      timeoutMs: 25,
      runtime: harness().runtime,
      verifyReleaseArtifact: async () => artifact("d"),
    }),
    (error) => error instanceof ReleaseSlotError && error.code === "invalid_input",
  );
});

test("a stalled external operation times out once with no retry or switch", async () => {
  const h = harness({ stalls: { checkCandidate: true } });
  await assert.rejects(
    h.controller.deploy({
      mode: "activate",
      archivePath: h.nextArtifact.archivePath,
      manifestPath: h.nextArtifact.manifestPath,
      expectedSourceSha: h.nextArtifact.sourceSha,
    }),
    (error) => error instanceof ReleaseSlotError && error.code === "timeout",
  );
  assert.equal(h.runtime.events.filter((event) => event.name === "checkCandidate").length, 0);
  assert.equal(h.runtime.events.filter((event) => event.name === "rejectCandidate").length, 1);
  assert.equal(h.runtime.events.some((event) => event.name === "switchActive"), false);
  const status = await h.controller.status();
  assert.equal(status.activeSlot, slots[0]);
});

test("timeout is bounded even when a transport ignores the abort signal", { timeout: HANG_GUARD_MS }, async () => {
  const h = harness();
  let checks = 0;
  h.runtime.checkCandidate = async () => {
    checks += 1;
    return new Promise(() => {});
  };
  await assert.rejects(
    h.controller.deploy({
      mode: "activate",
      archivePath: h.nextArtifact.archivePath,
      manifestPath: h.nextArtifact.manifestPath,
      expectedSourceSha: h.nextArtifact.sourceSha,
    }),
    (error) => error instanceof ReleaseSlotError && error.code === "timeout",
  );
  // 이 rejects 가 반환됐다는 사실 자체가 «경계가 abort 무시 transport 를 버렸다» 는 증거다.
  // 버리지 않았다면 위 await 는 영원히 끝나지 않고 HANG_GUARD_MS 에서 실패한다.
  assert.equal(checks, 1, "one bounded timeout must not become an implicit retry loop");
  assert.equal(h.runtime.events.some((event) => event.name === "switchActive"), false);
});

test("status is read-only and rejects malformed or single-slot configuration", async () => {
  const h = harness();
  const first = await h.controller.status();
  const second = await h.controller.status();
  assert.deepEqual(second, first);
  assert.throws(
    () => createReleaseSlots({ verifyReleaseArtifact: async () => h.nextArtifact, runtime: h.runtime, slotIds: ["only"], timeoutMs: 10 }),
    (error) => error instanceof ReleaseSlotError && error.code === "invalid_input",
  );
});

test("activation fails before prepare when the active release identity is missing or malformed", async () => {
  for (const artifactOverride of [null, { ...artifact("a"), sourceSha: "not-a-sha" }]) {
    const h = harness();
    const originalStatus = h.runtime.status.bind(h.runtime);
    h.runtime.status = async (input) => {
      const current = await originalStatus(input);
      current.slots[current.activeSlot].artifact = artifactOverride;
      return current;
    };
    await assert.rejects(
      h.controller.deploy({
        mode: "activate",
        archivePath: h.nextArtifact.archivePath,
        manifestPath: h.nextArtifact.manifestPath,
        expectedSourceSha: h.nextArtifact.sourceSha,
      }),
      (error) => error instanceof ReleaseSlotError && error.code === "status_invalid",
    );
    assert.equal(h.runtime.events.some((event) => event.name === "prepare"), false);
    assert.equal(h.runtime.events.some((event) => event.name === "switchActive"), false);
  }
});
