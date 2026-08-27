import test from "node:test";
import assert from "node:assert/strict";
import {
  VisualGateStageError,
  recordImplicitDomFailure,
  runVisualGateCompletionContractTests,
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

test("a score-only DOM failure cannot produce an empty failure list", () => {
  const result = recordImplicitDomFailure({ visual: 63, failures: [] }, 65);
  assert.deepEqual(result.failures, ["DOM assertion: visual score 63 is below 65"]);
});
