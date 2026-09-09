import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import {
  attachVisualFixtureDiagnostics,
  collectVisualFixtureResourceSnapshot,
  createVisualFixtureDiagnosticCollector,
  VisualGateStageError,
  isChildAndPortReleased,
  recordImplicitDomFailure,
  runVisualGateCompletionContractTests,
  sameOriginPathname,
  sanitizeVisualDiagnosticMessage,
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

test("hydration timeout diagnostics are bounded and redact raw browser data", async () => {
  class FakeScriptElement {
    constructor(src) {
      this.src = src;
    }
  }
  class FakePage {
    listeners = new Map();
    on(name, listener) {
      const listeners = this.listeners.get(name) ?? [];
      listeners.push(listener);
      this.listeners.set(name, listeners);
    }
    off(name, listener) {
      this.listeners.set(name, (this.listeners.get(name) ?? []).filter(candidate => candidate !== listener));
    }
    emit(name, value) {
      for (const listener of this.listeners.get(name) ?? []) listener(value);
    }
    async evaluate(callback, args) {
      const { expectedOrigin, limit } = args;
      assert.equal(expectedOrigin, "http://127.0.0.1:3101");
      assert.equal(limit, 12);
      const staticScript = new FakeScriptElement("http://127.0.0.1:3101/_next/static/chunks/app.js?token=secret");
      const unsafeStyle = { href: "http://127.0.0.1:3101/assets/customer-secret/style.css?token=secret" };
      return callback(args, {
        document: {
          readyState: "interactive",
          querySelectorAll: () => [staticScript, unsafeStyle],
        },
        location: { href: "http://127.0.0.1:3101/login/visual-fixture?token=secret" },
        performance: { getEntriesByName: raw => raw === staticScript.src ? [{ responseEnd: 10 }] : [] },
        HTMLScriptElement: FakeScriptElement,
        URL,
      });
    }
  }

  assert.deepEqual(collectVisualFixtureResourceSnapshot({
    expectedOrigin: "http://127.0.0.1:3101",
    limit: 12,
  }, {
    document: {
      readyState: "complete",
      querySelectorAll: () => [{ href: "http://127.0.0.1:3101/assets/customer-secret/style.css?token=x" }],
    },
    location: { href: "http://127.0.0.1:3101/login/visual-fixture" },
    performance: { getEntriesByName: () => [] },
    HTMLScriptElement: FakeScriptElement,
    URL,
  }), {
    documentReadyState: "complete",
    resources: [{
      pathname: null,
      routeClass: "same-origin-resource",
      resourceKind: "style",
      status: "unobserved",
    }],
  });

  const page = new FakePage();
  const collector = createVisualFixtureDiagnosticCollector(page, "http://127.0.0.1:3101");
  page.emit("console", { type: () => "error", text: () => "customer-name token=secret" });
  page.emit("pageerror", { message: "ReferenceError: customerSecret is not defined at https://example.test/?token=secret" });
  page.emit("requestfailed", {
    url: () => "http://127.0.0.1:3101/_next/static/chunks/app.js?token=secret#fragment",
    resourceType: () => "script",
    failure: () => ({ errorText: "net::ERR_CONNECTION_RESET secret" }),
  });
  page.emit("response", {
    url: () => "http://127.0.0.1:3101/_next/static/chunks/app.js?token=secret",
    status: () => 302,
  });
  page.emit("requestfailed", {
    url: () => "http://127.0.0.1:3101/api/customers/customer-secret-id?token=secret",
    resourceType: () => "fetch",
    failure: () => ({ errorText: "net::ERR_FAILED customer-secret-id" }),
  });
  page.emit("response", {
    url: () => "https://outside.example/_next/static/chunks/foreign.js?token=secret",
    status: () => 500,
  });

  const diagnostics = await collector.snapshot();
  assert.equal(diagnostics.documentReadyState, "interactive");
  assert.deepEqual(diagnostics.resources, [
    { pathname: "/_next/static/chunks/app.js", routeClass: "static-asset", resourceKind: "script", status: "loaded" },
    { pathname: null, routeClass: "same-origin-resource", resourceKind: "style", status: "pending" },
  ]);
  assert.deepEqual(diagnostics.events, [
    { kind: "console-error", pathname: null, status: null, resourceKind: "document", message: "redacted" },
    { kind: "page-error", pathname: null, status: null, resourceKind: "script", message: "ReferenceError: identifier is not defined" },
    { kind: "request-failed", pathname: "/_next/static/chunks/app.js", routeClass: "static-asset", status: null, resourceKind: "script", message: "Network ERR_CONNECTION_RESET" },
    { kind: "static-script-response", pathname: "/_next/static/chunks/app.js", routeClass: "static-asset", status: 302, resourceKind: "script", message: "Static script response failed" },
    { kind: "request-failed", pathname: null, routeClass: "same-origin", status: null, resourceKind: "fetch", message: "Network ERR_FAILED" },
  ]);
  assert.doesNotMatch(JSON.stringify(diagnostics), /secret|token=|customer-name|customers|outside\.example/iu);

  for (let index = 0; index < 20; index += 1) {
    page.emit("console", { type: () => "error", text: () => `untrusted value ${index}` });
  }
  assert.equal((await collector.snapshot()).events.length, 12);
  collector.dispose();
  assert.equal(page.listeners.get("console").length, 0);

  const timeout = new VisualGateStageError("render-completion", "fixture-render-complete", "timed out", {
    attempts: 3,
    lastError: "TypeError: secret value",
  });
  assert.equal(attachVisualFixtureDiagnostics(timeout, diagnostics), timeout);
  assert.deepEqual(timeout.details.diagnostics, diagnostics);
  assert.equal(timeout.details.lastError, "TypeError: redacted");
});

test("diagnostic messages and paths fail closed without leaking values", () => {
  assert.equal(sanitizeVisualDiagnosticMessage("TypeError: private customer value"), "TypeError: redacted");
  assert.equal(sanitizeVisualDiagnosticMessage("arbitrary application log"), "redacted");
  assert.equal(sameOriginPathname("http://127.0.0.1:3101/login/visual-fixture?secret=yes#x", "http://127.0.0.1:3101"), "/login/visual-fixture");
  assert.equal(sameOriginPathname("https://outside.example/path?secret=yes", "http://127.0.0.1:3101"), null);
});

test("the fixture loader installs diagnostics before navigation and emits no raw server tail", () => {
  const source = readFileSync(new URL("./qa-visual-blocks.mjs", import.meta.url), "utf8");
  const collector = source.indexOf("createVisualFixtureDiagnosticCollector(page,expectedOrigin)");
  const navigation = source.indexOf("await page.goto(url", collector);
  assert.ok(collector >= 0 && navigation > collector);
  assert.match(source, /attachVisualFixtureDiagnostics\(error,await diagnostics\.snapshot\(\)\)/u);
  assert.doesNotMatch(source, /log\.slice|\{log:/u);
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
