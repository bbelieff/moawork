import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertTransientUnitEmpty,
  nativeSmokeRuntimePaths,
  releaseSmokeEvidenceEnvelope,
  runTransientSmokeService,
  signReleaseArtifactAttestationFromEvidence,
  validateReleaseSmokeEvidenceEnvelope,
} from "./provenance.mjs";

const provenanceSource = readFileSync(new URL("./provenance.mjs", import.meta.url), "utf8");
const cliSource = readFileSync(new URL("./artifact.mjs", import.meta.url), "utf8");

const descriptor = Object.freeze({
  sourceSha: "1".repeat(40),
  sourceTree: "2".repeat(40),
  archiveSha256: "3".repeat(64),
  manifestSha256: "4".repeat(64),
  serverActionsKeyFingerprint: "5".repeat(64),
  builder: { platform: "linux", arch: "x64", nodeVersion: "v22.23.2", npmVersion: "10.9.2" },
});

const runtimeEvidence = Object.freeze({
  kind: "next-standalone-http-health-v1",
  platform: "linux",
  arch: "x64",
  nodeVersion: "v22.23.2",
  healthPath: "/api/health/live",
  sourceSha: descriptor.sourceSha,
  archiveSha256: descriptor.archiveSha256,
  serverActionsKeyFingerprint: descriptor.serverActionsKeyFingerprint,
});

function ci(job) {
  return {
    eventName: "workflow_dispatch",
    job,
    ref: "refs/heads/main",
    repository: "bbelieff/moawork",
    runAttempt: "2",
    runId: "12345",
    runnerArch: "X64",
    runnerOs: "Linux",
    sha: descriptor.sourceSha,
    workflowRef: "bbelieff/moawork/.github/workflows/vps-release-artifact.yml@refs/heads/main",
  };
}

test("isolated signer accepts only exact artifact, native result, and same protected workflow run evidence", () => {
  const evidence = releaseSmokeEvidenceEnvelope(descriptor, runtimeEvidence, ci("build-smoke"));
  assert.equal(validateReleaseSmokeEvidenceEnvelope(evidence, descriptor, ci("release-artifact")), evidence);
  for (const mutate of [
    (value) => { value.subject.archiveSha256 = "9".repeat(64); },
    (value) => { value.subject.sourceTree = "9".repeat(40); },
    (value) => { value.runtimeEvidence.healthPath = "/"; },
    (value) => { value.runtimeEvidence.archiveSha256 = "9".repeat(64); },
    (value) => { value.buildEvidence.job = "release-artifact"; },
    (value) => { value.buildEvidence.runId = "12346"; },
    (value) => { value.buildEvidence.runAttempt = "3"; },
    (value) => { value.buildEvidence.workflowRef = "bbelieff/moawork/.github/workflows/other.yml@refs/heads/main"; },
    (value) => { value.pass = true; },
    (value) => { value.runtimeEvidence.pass = true; },
  ]) {
    const changed = structuredClone(evidence);
    mutate(changed);
    assert.throws(() => validateReleaseSmokeEvidenceEnvelope(changed, descriptor, ci("release-artifact")));
  }
});

test("evidence signer source has no native payload execution or dependency lifecycle seam", () => {
  const source = signReleaseArtifactAttestationFromEvidence.toString();
  assert.doesNotMatch(source, /proveNativeLinuxRuntime|spawn\(|mkdtemp|destinationPath|npm|child/iu);
  assert.match(source, /readValidatedSmokeEvidence/);
  assert.match(source, /verifyReleaseArtifact/);
});

test("native smoke is isolated from control bytes and all descendants are reaped before evidence", () => {
  for (const required of [
    '"DynamicUser=yes"',
    '"PrivateTmp=yes"',
    '"NoNewPrivileges=yes"',
    '"CapabilityBoundingSet="',
    '"ProtectProc=invisible"',
    '"PrivateNetwork=yes"',
    '"KillMode=control-group"',
    '"SendSIGKILL=yes"',
    '"RuntimeMaxSec=30s"',
    '"StandardOutput=null"',
    '`InaccessiblePaths=${controlDirectory}`',
    "LoadCredential=server-actions-key",
    "$CREDENTIALS_DIRECTORY/server-actions-key",
    '"/usr/bin/nsenter"',
    "/proc/${mainPid}/cgroup",
    '"cgroup.events"',
    "populated 0",
    "assertPrivateSmokeControlPaths",
    "makeRuntimeTreeReadOnly",
    "const afterSmoke = await verifyReleaseArtifact",
    "MAX_SMOKE_EVIDENCE_BYTES",
  ]) assert.match(provenanceSource, new RegExp(required.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.doesNotMatch(provenanceSource, /export async function signReleaseArtifactAttestation\(/u);
  assert.doesNotMatch(provenanceSource, /--setenv=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY/u);
});

test("runtime path plan imports only the verified release into private tmp", () => {
  const plan = nativeSmokeRuntimePaths("/tmp/private-inspection/release");
  assert.equal(plan.bindProperty, "BindReadOnlyPaths=/tmp/private-inspection/release:/tmp/moawork-runtime");
  assert.equal(plan.appRoot, "/tmp/moawork-runtime/runtime/app");
  assert.equal(plan.entrypoint, `${plan.appRoot}/server.js`);
  assert.doesNotMatch(plan.appRoot, /private-inspection/u);
  assert.match(provenanceSource, /await makeRuntimeTreeReadOnly\(releaseRoot\)/u);
  assert.doesNotMatch(provenanceSource, /makeRuntimeTreeReadOnly\(inspectionRoot\)/u);
});

test("accepted start with lost response still stops and verifies the exact unit before credential removal", async () => {
  const calls = [];
  await assert.rejects(() => runTransientSmokeService({
    unit: "fixture.service", startArgs: ["fixture"], credentialPath: "credential", probe: () => assert.fail("probe after start failure"),
  }, {
    run: async () => { calls.push("accepted-start"); throw new Error("client timeout after acceptance"); },
    stopAndVerify: async (unit) => { assert.equal(unit, "fixture.service"); calls.push("stop-and-empty"); },
    removeCredential: async () => { calls.push("remove-credential"); },
  }), /could not start/u);
  assert.deepEqual(calls, ["accepted-start", "stop-and-empty", "remove-credential"]);
});

test("credential deletion failure cannot skip unit cleanup", async () => {
  const calls = [];
  await assert.rejects(() => runTransientSmokeService({
    unit: "fixture.service", startArgs: [], credentialPath: "credential", probe: () => assert.fail("probe after credential failure"),
  }, {
    run: async () => { calls.push("start"); },
    removeCredential: async () => { calls.push("remove"); if (calls.length === 2) throw new Error("deletion failed"); },
    stopAndVerify: async () => { calls.push("stop-and-empty"); },
  }), /deletion failed/u);
  assert.deepEqual(calls, ["start", "remove", "stop-and-empty", "remove"]);
});

test("health success is withheld until cleanup succeeds; probe failure also cleans", async () => {
  for (const failingPhase of [null, "probe", "cleanup"]) {
    const calls = [];
    const operation = runTransientSmokeService({
      unit: "fixture.service", startArgs: [], credentialPath: "credential",
      probe: async (group) => {
        assert.equal(group, "/fixture"); calls.push("probe");
        if (failingPhase === "probe") throw new Error("probe failed");
        return "health";
      },
    }, {
      run: async () => { calls.push("start"); },
      removeCredential: async () => { calls.push("remove"); },
      readProperty: async () => "/fixture",
      stopAndVerify: async (_unit, group) => {
        assert.equal(group, "/fixture"); calls.push("cleanup");
        if (failingPhase === "cleanup") throw new Error("descendants remain");
      },
    });
    if (failingPhase) await assert.rejects(operation);
    else assert.equal(await operation, "health");
    assert.deepEqual(calls, ["start", "remove", "probe", "cleanup", "remove"]);
  }
});

test("cleanup distinguishes manager-confirmed absence from missing identity and occupied cgroup", async () => {
  const stopped = [];
  const run = async (_command, args) => { stopped.push(args.at(-1)); };
  await assertTransientUnitEmpty("absent.service", "", {
    run, readProperty: async (_unit, key) => key === "LoadState" ? "not-found" : "",
  });
  await assert.rejects(() => assertTransientUnitEmpty("unknown.service", "", {
    run, readProperty: async () => "",
  }), /identity is unavailable/u);
  await assert.rejects(() => assertTransientUnitEmpty("live.service", "/fixture", {
    run, readEvents: async () => "populated 1\n",
  }), /still has descendants/u);
  await assertTransientUnitEmpty("empty.service", "/fixture", { run, readEvents: async () => "populated 0\n" });
  assert.deepEqual(stopped, ["absent.service", "unknown.service", "live.service", "empty.service"]);
});

test("canonical gate registers isolated signing exactly once", () => {
  const gate = readFileSync(new URL("../../../scripts/check.sh", import.meta.url), "utf8");
  assert.equal(gate.split("node --test ops/vps/artifact/isolated-signing.test.mjs").length - 1, 1);
});

test("CLI exposes evidence-only signing and no combined payload-plus-key command", () => {
  assert.doesNotMatch(cliSource, /command === "attest"/u);
  assert.doesNotMatch(cliSource, /artifact[.]mjs attest \\\\n/u);
  assert.match(cliSource, /command === "attest-evidence"/u);
});
