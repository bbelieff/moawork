import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import {
  VisualGateStageError,
  isChildAndPortReleased,
  recordImplicitDomFailure,
  runVisualGateCompletionContractTests,
  verifyBuildProvenance,
  waitForVisualGate,
} from "./qa-visual-gate-completion.mjs";

test("completion contract waits for listener, expected SHA, and stable render", async () => {
  await runVisualGateCompletionContractTests();
});

test("timeout preserves infrastructure stage details", async () => {
  let clock = 0;
  await assert.rejects(
    waitForVisualGate({
      category: "infrastructure",
      stage: "server-ready",
      timeoutMs: 10,
      intervalMs: 5,
      now: () => clock,
      sleep: milliseconds => { clock += milliseconds; },
      probe: async () => ({ ready: false, listener: true, sha: "wrong" }),
    }),
    error => error instanceof VisualGateStageError
      && error.category === "infrastructure"
      && error.stage === "server-ready"
      && error.details.last.sha === "wrong",
  );
});

test("render timeout remains distinct from listener and DOM assertion failures", async () => {
  let clock = 0;
  await assert.rejects(
    waitForVisualGate({
      category: "render-completion",
      stage: "fixture-render-complete",
      timeoutMs: 10,
      intervalMs: 5,
      now: () => clock,
      sleep: milliseconds => { clock += milliseconds; },
      probe: async () => ({ ready: false, hydrated: true, stableFrames: 1 }),
    }),
    error => error instanceof VisualGateStageError
      && error.category === "render-completion"
      && error.stage === "fixture-render-complete"
      && error.details.last.stableFrames === 1,
  );
});

test("a never-resolving render probe is bounded by its stage deadline", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    waitForVisualGate({
      category: "render-completion",
      stage: "fixture-render-complete",
      timeoutMs: 20,
      intervalMs: 1,
      probe: () => new Promise(() => {}),
    }),
    error => error instanceof VisualGateStageError
      && error.category === "render-completion"
      && error.stage === "fixture-render-complete"
      && error.message.includes("probe exceeded"),
  );
  assert.ok(Date.now() - startedAt < 200, "hung probe escaped the configured deadline");
});

test("TCP cleanup stays RED while a reset-only listener still owns the port", async t => {
  const listener = createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise(resolve => listener.close(resolve)));
  const address = listener.address();
  assert.ok(address && typeof address === "object");

  const occupied = await isChildAndPortReleased({ childExited: true, host: "127.0.0.1", port: address.port });
  assert.equal(occupied.ready, false);
  assert.equal(occupied.tcp.open, true);

  const competitor = createServer();
  const bindError = await new Promise(resolve => {
    competitor.once("error", resolve);
    competitor.listen(address.port, "127.0.0.1", () => resolve(null));
  });
  competitor.close();
  assert.equal(bindError?.code, "EADDRINUSE");
});

test("artifact SHA A cannot satisfy expected checkout SHA B", () => {
  const artifactA = {
    commitSha: "a".repeat(40),
    sourceDigest: "source-a",
    buildId: "build-a",
    artifactDigest: "artifact-a",
  };
  const expectedB = { ...artifactA, commitSha: "b".repeat(40) };
  assert.deepEqual(verifyBuildProvenance(artifactA, expectedB), {
    ready: false,
    mismatches: ["commitSha"],
    artifactSha: "a".repeat(40),
    expectedSha: "b".repeat(40),
  });
});

test("a score-only DOM failure cannot produce an empty failure list", () => {
  const result = recordImplicitDomFailure({ visual: 63, failures: [] }, 65);
  assert.deepEqual(result.failures, ["DOM assertion: visual score 63 is below 65"]);
});

test("focus restoration polling accepts the following frame and bounds never-focus", async () => {
  let clock = 0;
  let samples = 0;
  const delayed = await waitForVisualGate({
    category: "dom-assertion",
    stage: "modal-focus-return",
    timeoutMs: 1000,
    intervalMs: 16,
    now: () => clock,
    sleep: milliseconds => { clock += milliseconds; },
    probe: async () => {
      samples += 1;
      const focused = samples >= 2;
      return { ready: focused, focused };
    },
  });
  assert.equal(delayed.attempts, 2);
  assert.equal(delayed.focused, true);

  clock = 0;
  await assert.rejects(
    waitForVisualGate({
      category: "dom-assertion",
      stage: "detail-focus-return",
      timeoutMs: 32,
      intervalMs: 16,
      now: () => clock,
      sleep: milliseconds => { clock += milliseconds; },
      probe: async () => ({ ready: false, focused: false }),
    }),
    error => error instanceof VisualGateStageError
      && error.category === "dom-assertion"
      && error.stage === "detail-focus-return"
      && error.details.last.focused === false,
  );
});

test("modal and detail Escape checks use the bounded connected-focus contract", () => {
  const source = readFileSync(new URL("./qa-visual-blocks.mjs", import.meta.url), "utf8");
  assert.match(source, /async function waitForConnectedFocus\(element,stage\)/u);
  assert.match(source, /timeoutMs:1000,intervalMs:16/u);
  assert.match(source, /el\.isConnected&&document\.activeElement===el/u);
  assert.match(source, /waitForConnectedFocus\(modalProbeHandle,"modal-focus-return"\)/u);
  assert.match(source, /waitForConnectedFocus\(openerHandle,"detail-focus-return"\)/u);
  assert.match(source, /interaction: modal Escape focus return missing/u);
  assert.match(source, /new-lead detail: Escape opener focus return missing/u);
  assert.doesNotMatch(source, /modalProbe\.evaluate\(el=>document\.activeElement===el\)/u);
  assert.doesNotMatch(source, /opener\.evaluate\(el=>document\.activeElement===el\)/u);
});
