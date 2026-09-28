import { createConnection } from "node:net";

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

const VISUAL_DIAGNOSTIC_EVENT_LIMIT = 12;
const VISUAL_DIAGNOSTIC_RESOURCE_LIMIT = 12;
const VISUAL_DIAGNOSTIC_RESOURCE_KINDS = new Set([
  "document", "script", "style", "stylesheet", "image", "font", "xhr", "fetch", "other",
]);

export function sanitizeVisualDiagnosticMessage(value) {
  const message = String(value ?? "");
  const networkCode = message.match(/\bnet::(ERR_[A-Z_]+)\b/u)?.[1];
  if (networkCode) return `Network ${networkCode}`;
  if (/hydration failed/iu.test(message)) return "Hydration failed";
  if (/chunkloaderror|loading chunk.+failed/iu.test(message)) return "Chunk load failed";
  if (/failed to load resource/iu.test(message)) return "Resource load failed";
  if (/unexpected token/iu.test(message)) return "SyntaxError: unexpected token";
  if (/cannot read propert(?:y|ies)/iu.test(message)) return "TypeError: cannot read property";
  if (/is not defined/iu.test(message)) return "ReferenceError: identifier is not defined";
  const name = message.match(/^(TypeError|ReferenceError|SyntaxError|RangeError|Error)\b/iu)?.[1];
  return name ? `${name}: redacted` : "redacted";
}

export function sameOriginPathname(value, expectedOrigin) {
  try {
    const url = new URL(String(value), expectedOrigin);
    return url.origin === expectedOrigin ? url.pathname.slice(0, 240) : null;
  } catch {
    return null;
  }
}

function safeStaticAssetPathname(value, expectedOrigin) {
  const pathname = sameOriginPathname(value, expectedOrigin);
  if (!pathname || !/^\/_next\/static\/[A-Za-z0-9._/-]+\.(?:js|css|woff2?|png|jpe?g|svg|webp|ico|map)$/u.test(pathname)) return null;
  if (pathname.split("/").some(segment => segment === "." || segment === "..")) return null;
  return pathname;
}

function sameOriginRouteClass(value, expectedOrigin) {
  const pathname = sameOriginPathname(value, expectedOrigin);
  if (!pathname) return null;
  if (pathname === "/login/visual-fixture") return "visual-fixture";
  if (pathname.startsWith("/_next/")) return "next-internal";
  return "same-origin";
}

function safeResourceKind(value) {
  const kind = String(value ?? "other");
  return VISUAL_DIAGNOSTIC_RESOURCE_KINDS.has(kind) ? kind : "other";
}

export function collectVisualFixtureResourceSnapshot({ expectedOrigin, limit }, runtime = globalThis) {
  const document = runtime.document;
  const resources = [...document.querySelectorAll("script[src],link[rel='stylesheet'][href]")]
    .flatMap(element => {
      const isScript = element instanceof runtime.HTMLScriptElement;
      const raw = isScript ? element.src : element.href;
      let url;
      try {
        url = new runtime.URL(raw, runtime.location.href);
      } catch {
        return [];
      }
      if (url.origin !== expectedOrigin) return [];
      const pathname = /^\/_next\/static\/[A-Za-z0-9._/-]+\.(?:js|css|woff2?|png|jpe?g|svg|webp|ico|map)$/u.test(url.pathname)
        && !url.pathname.split("/").some(segment => segment === "." || segment === "..")
        ? url.pathname.slice(0, 240)
        : null;
      const entry = runtime.performance.getEntriesByName(raw).at(-1);
      return [{
        pathname,
        routeClass: pathname ? "static-asset" : "same-origin-resource",
        resourceKind: isScript ? "script" : "style",
        status: entry?.responseEnd > 0 ? "loaded" : document.readyState === "complete" ? "unobserved" : "pending",
      }];
    })
    .slice(0, limit);
  return { documentReadyState: document.readyState, resources };
}

export function createVisualFixtureDiagnosticCollector(page, expectedOrigin) {
  const events = [];
  const record = event => {
    if (events.length < VISUAL_DIAGNOSTIC_EVENT_LIMIT) events.push(event);
  };
  const onConsole = message => {
    if (message.type() !== "error") return;
    record({
      kind: "console-error",
      pathname: null,
      status: null,
      resourceKind: "document",
      message: sanitizeVisualDiagnosticMessage(message.text()),
    });
  };
  const onPageError = error => record({
    kind: "page-error",
    pathname: null,
    status: null,
    resourceKind: "script",
    message: sanitizeVisualDiagnosticMessage(error?.message),
  });
  const onRequestFailed = request => {
    const pathname = safeStaticAssetPathname(request.url(), expectedOrigin);
    const routeClass = pathname ? "static-asset" : sameOriginRouteClass(request.url(), expectedOrigin);
    if (!routeClass) return;
    record({
      kind: "request-failed",
      pathname,
      routeClass,
      status: null,
      resourceKind: safeResourceKind(request.resourceType()),
      message: sanitizeVisualDiagnosticMessage(request.failure()?.errorText),
    });
  };
  const onResponse = response => {
    const pathname = safeStaticAssetPathname(response.url(), expectedOrigin);
    const status = response.status();
    if (!pathname || (status >= 200 && status < 300) || !pathname.endsWith(".js")) return;
    record({
      kind: "static-script-response",
      pathname,
      routeClass: "static-asset",
      status,
      resourceKind: "script",
      message: "Static script response failed",
    });
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("requestfailed", onRequestFailed);
  page.on("response", onResponse);

  return {
    async snapshot() {
      let documentState = { documentReadyState: "unavailable", resources: [] };
      try {
        documentState = await page.evaluate(collectVisualFixtureResourceSnapshot, {
          expectedOrigin,
          limit: VISUAL_DIAGNOSTIC_RESOURCE_LIMIT,
        });
      } catch {
        // A closed/crashed page is itself useful state; never attach the raw browser error.
      }
      return {
        documentReadyState: documentState.documentReadyState,
        events: [...events],
        resources: documentState.resources,
      };
    },
    dispose() {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      page.off("requestfailed", onRequestFailed);
      page.off("response", onResponse);
    },
  };
}

export function attachVisualFixtureDiagnostics(error, diagnostics) {
  if (error instanceof VisualGateStageError
    && error.category === "render-completion"
    && error.stage === "fixture-render-complete") {
    const details = { ...error.details };
    if (details.lastError) details.lastError = sanitizeVisualDiagnosticMessage(details.lastError);
    error.details = { ...details, diagnostics };
  }
  return error;
}

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
    const remainingMs = Math.max(1, timeoutMs - (now() - startedAt));
    let deadline;
    try {
      last = await Promise.race([
        Promise.resolve().then(probe),
        new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new VisualGateStageError(
            category,
            stage,
            `probe exceeded the remaining ${remainingMs}ms deadline`,
            { attempts, last },
          )), remainingMs);
        }),
      ]);
      lastError = null;
      if (last?.ready) return { ...last, attempts };
    } catch (error) {
      if (error instanceof VisualGateStageError) throw error;
      lastError = error;
    } finally {
      clearTimeout(deadline);
    }
    await sleep(intervalMs);
  }

  throw new VisualGateStageError(category, stage, `timed out after ${attempts} probes`, {
    attempts,
    last,
    lastError: lastError instanceof Error ? lastError.message : String(lastError ?? ""),
  });
}

export function probeTcpPort(host, port, timeoutMs = 250) {
  return new Promise(resolve => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => finish({ open: true, state: "connected" }));
    socket.once("error", error => finish({
      open: error?.code !== "ECONNREFUSED",
      state: error?.code === "ECONNREFUSED" ? "refused" : "error",
      errorCode: error?.code ?? null,
    }));
    socket.setTimeout(timeoutMs, () => finish({ open: true, state: "timeout" }));
  });
}

export async function isChildAndPortReleased({ childExited, host, port, timeoutMs = 250 }) {
  const tcp = await probeTcpPort(host, port, timeoutMs);
  return { ready: childExited && !tcp.open, childExited, tcp };
}

export function verifyBuildProvenance(provenance, expected) {
  const mismatches = ["commitSha", "sourceDigest", "buildId", "artifactDigest"]
    .filter(key => !provenance || provenance[key] !== expected[key]);
  return {
    ready: mismatches.length === 0,
    mismatches,
    artifactSha: provenance?.commitSha ?? null,
    expectedSha: expected.commitSha,
  };
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
