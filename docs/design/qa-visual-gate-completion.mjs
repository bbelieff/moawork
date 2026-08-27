export class VisualGateStageError extends Error {
  constructor(category, stage, message, details = {}) {
    super(`[${category}:${stage}] ${message}`);
    this.name = "VisualGateStageError";
    this.category = category;
    this.stage = stage;
    this.details = details;
  }
}

const defaultSleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function waitForVisualGate({
  category,
  stage,
  timeoutMs,
  intervalMs,
  probe,
  now = Date.now,
  sleep = defaultSleep,
}) {
  const startedAt = now();
  let attempts = 0;
  let last = null;
  let lastError = null;

  while (now() - startedAt <= timeoutMs) {
    attempts += 1;
    try {
      last = await probe();
      lastError = null;
      if (last?.ready) return { ...last, attempts };
    } catch (error) {
      if (error instanceof VisualGateStageError) throw error;
      lastError = error;
    }
    await sleep(intervalMs);
  }

  throw new VisualGateStageError(category, stage, `timed out after ${attempts} probes`, {
    attempts,
    last,
    lastError: lastError instanceof Error ? lastError.message : String(lastError ?? ""),
  });
}

export function recordImplicitDomFailure(testCase, minimumVisual) {
  if (testCase.visual < minimumVisual && testCase.failures.length === 0) {
    testCase.failures.push(`DOM assertion: visual score ${testCase.visual} is below ${minimumVisual}`);
  }
  return testCase;
}

export async function runVisualGateCompletionContractTests() {
  let clock = 0;
  let probeIndex = 0;
  const states = [
    { ready: false, listener: false, sha: null },
    { ready: false, listener: true, sha: "stale" },
    { ready: true, listener: true, sha: "expected" },
  ];
  const ready = await waitForVisualGate({
    category: "infrastructure",
    stage: "server-ready",
    timeoutMs: 30,
    intervalMs: 10,
    now: () => clock,
    sleep: milliseconds => { clock += milliseconds; },
    probe: async () => states[probeIndex++],
  });
  if (ready.attempts !== 3 || ready.sha !== "expected") throw new Error("server-ready did not wait for expected SHA");

  clock = 0;
  probeIndex = 0;
  const renderStates = [
    { ready: false, hydrated: false, stableFrames: 0 },
    { ready: false, hydrated: true, stableFrames: 1 },
    { ready: true, hydrated: true, stableFrames: 3 },
  ];
  const rendered = await waitForVisualGate({
    category: "render-completion",
    stage: "fixture-render-complete",
    timeoutMs: 30,
    intervalMs: 10,
    now: () => clock,
    sleep: milliseconds => { clock += milliseconds; },
    probe: async () => renderStates[probeIndex++],
  });
  if (rendered.attempts !== 3 || rendered.stableFrames !== 3) throw new Error("fixture completion accepted an unsettled render");

  clock = 0;
  let timeout;
  try {
    await waitForVisualGate({
      category: "infrastructure",
      stage: "browser-listener",
      timeoutMs: 20,
      intervalMs: 10,
      now: () => clock,
      sleep: milliseconds => { clock += milliseconds; },
      probe: async () => ({ ready: false, listener: false }),
    });
  } catch (error) {
    timeout = error;
  }
  if (!(timeout instanceof VisualGateStageError) || timeout.category !== "infrastructure" || timeout.stage !== "browser-listener") {
    throw new Error("listener timeout was not classified as infrastructure");
  }

  const failedCase = recordImplicitDomFailure({ visual: 64, failures: [] }, 65);
  if (failedCase.failures.length !== 1 || !failedCase.failures[0].startsWith("DOM assertion:")) {
    throw new Error("empty DOM assertion failure was not made explicit");
  }
}
