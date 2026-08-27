import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  acquireGateLease,
  createLeaseBroker,
  GateLeaseError,
} from "./gate-lease-core.mjs";
import { resolveGateCommand } from "./gate-lease-runner.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = fileURLToPath(new URL("./gate-lease.mjs", import.meta.url));
const HARNESS = fileURLToPath(new URL("./gate-lease-test-harness.mjs", import.meta.url));
const CLEANUP = fileURLToPath(new URL("./gate-lease-test-cleanup.ps1", import.meta.url));

function cleanupFence(fenceName) {
  if (process.platform !== "win32") return;
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  spawnSync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", CLEANUP, "-FenceName", fenceName], { windowsHide: true });
}

async function waitUntil(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition timed out");
}

function testFence() {
  return `Global\\MoaWork.FullGate.Test.${randomUUID()}`;
}

function startHarness({ broker, fenceName, expression, args = [], cwd = ROOT, ...config }) {
  const encoded = Buffer.from(JSON.stringify({
    host: "127.0.0.1",
    port: broker.port,
    fenceName,
    waitTimeoutMs: 5_000,
    runTimeoutMs: 5_000,
    bootstrapTimeoutMs: 5_000,
    ...config,
  })).toString("base64url");
  const child = spawn(process.execPath, [HARNESS, encoded, "--", process.execPath, "-e", expression, ...args], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  return { child, exited, output: () => output };
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
}

test("broker remains FIFO but is not the machine safety fence", async () => {
  const broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 20, idleTimeoutMs: -1 });
  try {
    const order = [];
    const first = await acquireGateLease({ port: broker.port, requestId: "a", label: "a" });
    order.push("a");
    const secondPromise = acquireGateLease({ port: broker.port, requestId: "b", label: "b" }).then((lease) => {
      order.push("b"); return lease;
    });
    await waitUntil(() => broker.snapshot().queued.length === 1);
    first.release();
    const second = await secondPromise;
    assert.deepEqual(order, ["a", "b"]);
    second.release();
  } finally { await broker.close(); }
});

test("duplicate request and bounded wait fail closed", async () => {
  const broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 20, idleTimeoutMs: -1 });
  try {
    const owner = await acquireGateLease({ port: broker.port, requestId: "same", label: "owner" });
    await assert.rejects(
      acquireGateLease({ port: broker.port, requestId: "same", label: "duplicate", waitTimeoutMs: 200 }),
      (error) => error instanceof GateLeaseError && error.code === "DUPLICATE_REQUEST",
    );
    owner.release();
  } finally { await broker.close(); }
});

test("production CLI has no test endpoint and rejects direct POSIX/WSL ownership", () => {
  const endpoint = spawnSync(process.execPath, [CLI, "--test-endpoint", "127.0.0.1", "1"], {
    cwd: ROOT, encoding: "utf8", windowsHide: true,
  });
  assert.equal(endpoint.status, 78);
  assert.match(`${endpoint.stdout}${endpoint.stderr}`, /GATE_TEST_ENDPOINT_REMOVED/u);
});

test(".bat and .cmd commands are rejected before guardian bootstrap", () => {
  assert.throws(() => resolveGateCommand("unsafe.cmd"), (error) => error.code === "GATE_COMMAND_SHELL_SCRIPT_REJECTED");
  assert.throws(() => resolveGateCommand("unsafe.bat"), (error) => error.code === "GATE_COMMAND_SHELL_SCRIPT_REJECTED");
});

test("guardian spawn error is structured and leaves no fence or process orphan", { skip: process.platform !== "win32" }, async () => {
  const broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 20, idleTimeoutMs: -1 });
  const fenceName = testFence();
  cleanupFence(fenceName);
  const failed = startHarness({
    broker,
    fenceName,
    expression: "console.log('MUST_NOT_START')",
    testGuardianMode: "spawn-error",
    bootstrapTimeoutMs: 1_000,
  });
  let successor;
  try {
    const started = Date.now();
    const result = await failed.exited;
    assert.notEqual(result.code, 0);
    assert.ok(Date.now() - started < 3_000, failed.output());
    assert.match(failed.output(), /GATE_GUARDIAN_FAILURE.*GATE_GUARDIAN_SPAWN_FAILED/u);
    assert.doesNotMatch(failed.output(), /MUST_NOT_START/u);

    successor = startHarness({ broker, fenceName, expression: "console.log('SPAWN_FAILURE_RECOVERED')" });
    const successorResult = await successor.exited;
    assert.equal(successorResult.code, 0, successor.output());
    assert.match(successor.output(), /SPAWN_FAILURE_RECOVERED/u);
    assert.equal(broker.snapshot().active, null);
    assert.deepEqual(broker.snapshot().queued, []);
  } finally {
    await stop(failed.child);
    await stop(successor?.child);
    await broker.close();
    cleanupFence(fenceName);
  }
});

test("owner-only named pipe READY binds wrapper and structured argv", { skip: process.platform !== "win32" }, async () => {
  const broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 20, idleTimeoutMs: -1 });
  const fenceName = testFence();
  const run = startHarness({
    broker,
    fenceName,
    expression: "console.log('ARGS:' + JSON.stringify(process.argv.slice(1)))",
    args: ["space value", 'quote"value', "amp&value", "tail\\"],
  });
  try {
    const result = await run.exited;
    assert.equal(result.code, 0, run.output());
    assert.match(run.output(), /GATE_GUARDIAN_READY/u);
    assert.match(run.output(), /GATE_FENCE_ACQUIRED/u);
    assert.match(run.output(), /ARGS:\["space value","quote\\"value","amp&value","tail\\\\"\]/u);
    assert.match(run.output(), /"activeProcesses":0/u);
  } finally { await stop(run.child); await broker.close(); }
});

test("broker restart during active command cannot bypass the OS fence", { skip: process.platform !== "win32" }, async () => {
  let broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 20, idleTimeoutMs: -1 });
  const port = broker.port;
  const fenceName = testFence();
  const first = startHarness({ broker, fenceName, expression: "console.log('FIRST_START'); setTimeout(() => {}, 900)" });
  let second;
  try {
    await waitUntil(() => first.output().includes("FIRST_START"));
    await broker.close();
    broker = await createLeaseBroker({ port, diagnosticIntervalMs: 20, idleTimeoutMs: -1 });
    second = startHarness({ broker, fenceName, expression: "console.log('SECOND_START')" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.doesNotMatch(second.output(), /SECOND_START/u);
    await first.exited;
    const secondResult = await second.exited;
    assert.equal(secondResult.code, 0, second.output());
    assert.match(second.output(), /SECOND_START/u);
  } finally { await stop(first.child); await stop(second?.child); await broker.close(); }
});

test("cleanup quarantine survives broker restart and starts no successor", { skip: process.platform !== "win32" }, async () => {
  let broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 20, idleTimeoutMs: -1 });
  const port = broker.port;
  const fenceName = testFence();
  const first = startHarness({
    broker, fenceName, expression: "setInterval(() => {}, 1000)", runTimeoutMs: 100, testFault: "cleanup-hang",
  });
  let second;
  try {
    await waitUntil(() => first.output().includes("GATE_GUARDIAN_QUARANTINED"), 8_000);
    await broker.close();
    broker = await createLeaseBroker({ port, diagnosticIntervalMs: 20, idleTimeoutMs: -1 });
    second = startHarness({ broker, fenceName, expression: "console.log('MUST_NOT_START')" });
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.doesNotMatch(second.output(), /MUST_NOT_START/u);
    const firstGuardian = Number(first.output().match(/GATE_GUARDIAN_READY[^\n]*"guardianPid":(\d+)/u)?.[1]);
    assert.ok(firstGuardian > 0, first.output());
    process.kill(firstGuardian, "SIGKILL");
    await waitUntil(() => second.output().includes("GATE_GUARDIAN_QUARANTINED"), 5_000);
    assert.doesNotMatch(second.output(), /MUST_NOT_START/u);
  } finally {
    const secondGuardian = Number(second?.output().match(/GATE_GUARDIAN_READY[^\n]*"guardianPid":(\d+)/u)?.[1]);
    if (secondGuardian > 0) { try { process.kill(secondGuardian, "SIGKILL"); } catch {} }
    await stop(first.child); await stop(second?.child); await broker.close(); cleanupFence(fenceName);
  }
});

test("guardian SIGKILL abandons the fence and successor quarantines without start", { skip: process.platform !== "win32" }, async () => {
  const broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 20, idleTimeoutMs: -1 });
  const fenceName = testFence();
  const first = startHarness({ broker, fenceName, expression: "console.log('ACTIVE'); setInterval(() => {}, 1000)" });
  let second;
  try {
    await waitUntil(() => first.output().includes("ACTIVE"));
    const guardianPid = Number(first.output().match(/GATE_GUARDIAN_READY[^\n]*"guardianPid":(\d+)/u)?.[1]);
    process.kill(guardianPid, "SIGKILL");
    await first.exited;
    second = startHarness({ broker, fenceName, expression: "console.log('MUST_NOT_START')" });
    await waitUntil(() => second.output().includes("GATE_GUARDIAN_QUARANTINED"), 5_000);
    assert.doesNotMatch(second.output(), /MUST_NOT_START/u);
  } finally {
    const secondGuardian = Number(second?.output().match(/GATE_GUARDIAN_READY[^\n]*"guardianPid":(\d+)/u)?.[1]);
    if (secondGuardian > 0) { try { process.kill(secondGuardian, "SIGKILL"); } catch {} }
    await stop(first.child); await stop(second?.child); await broker.close(); cleanupFence(fenceName);
  }
});

test("wrapper PID substitution is rejected before command start", { skip: process.platform !== "win32" }, async () => {
  const broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 20, idleTimeoutMs: -1 });
  const identity = spawn(process.execPath, ["-e", "setTimeout(() => {}, 80)"], { stdio: "ignore", windowsHide: true });
  const run = startHarness({
    broker, fenceName: testFence(), wrapperPid: identity.pid,
    expression: "console.log('MUST_NOT_START')", bootstrapTimeoutMs: 1_000,
  });
  try {
    const result = await run.exited;
    assert.notEqual(result.code, 0);
    assert.doesNotMatch(run.output(), /MUST_NOT_START/u);
  } finally { await stop(identity); await stop(run.child); await broker.close(); }
});

test("detached grandchild remains inside the Job until it exits", { skip: process.platform !== "win32" }, async () => {
  const broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 20, idleTimeoutMs: -1 });
  const fenceName = testFence();
  const expression = "const {spawn}=require('node:child_process');spawn(process.execPath,['-e','setTimeout(()=>{},700)'],{detached:true,stdio:'ignore'}).unref();console.log('PARENT_EXIT')";
  const first = startHarness({ broker, fenceName, expression });
  let second;
  try {
    await waitUntil(() => first.output().includes("PARENT_EXIT"));
    second = startHarness({ broker, fenceName, expression: "console.log('SECOND_AFTER_TREE')" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.doesNotMatch(second.output(), /SECOND_AFTER_TREE/u);
    await first.exited;
    assert.equal((await second.exited).code, 0, second.output());
  } finally { await stop(first.child); await stop(second?.child); await broker.close(); }
});

test("bootstrap stall is bounded, killed, and starts no command", { skip: process.platform !== "win32" }, async () => {
  const broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 20, idleTimeoutMs: -1 });
  const run = startHarness({
    broker, fenceName: testFence(), expression: "console.log('MUST_NOT_START')",
    testFault: "stall-bootstrap", bootstrapTimeoutMs: 250,
  });
  try {
    const started = Date.now();
    const result = await run.exited;
    assert.notEqual(result.code, 0);
    assert.ok(Date.now() - started < 3_000, run.output());
    assert.doesNotMatch(run.output(), /MUST_NOT_START/u);
  } finally { await stop(run.child); await broker.close(); }
});

for (const mode of ["never-connect", "stall-add-type"]) {
  test(`bootstrap ${mode} is bounded and guardian is terminated`, { skip: process.platform !== "win32" }, async () => {
    const broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 20, idleTimeoutMs: -1 });
    const run = startHarness({
      broker, fenceName: testFence(), expression: "console.log('MUST_NOT_START')",
      testGuardianMode: mode, bootstrapTimeoutMs: 250,
    });
    try {
      const started = Date.now();
      const result = await run.exited;
      assert.notEqual(result.code, 0);
      assert.ok(Date.now() - started < 3_000, run.output());
      assert.doesNotMatch(run.output(), /MUST_NOT_START/u);
    } finally { await stop(run.child); await broker.close(); }
  });
}

test("signal IPC preserves exit 143 after verified zero", { skip: process.platform !== "win32" }, async () => {
  const broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 20, idleTimeoutMs: -1 });
  const run = startHarness({
    broker, fenceName: testFence(), expression: "setInterval(() => {}, 1000)",
    testSignalAfterMs: 500, testSignal: "SIGTERM",
  });
  try {
    const result = await run.exited;
    assert.equal(result.code, 143, run.output());
    assert.match(run.output(), /GATE_LEASE_INTERRUPTED/u);
    assert.match(run.output(), /"activeProcesses":0/u);
  } finally { await stop(run.child); await broker.close(); }
});

test("Windows and WSL process trees share one fence and boot identity", { skip: process.platform !== "win32" }, async () => {
  const hasWsl = spawnSync("wsl.exe", ["bash", "-lc", "uname -r"], { encoding: "utf8", windowsHide: true });
  assert.equal(hasWsl.status, 0, `${hasWsl.stdout}${hasWsl.stderr}`);
  const broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 20, idleTimeoutMs: -1 });
  const fenceName = testFence();
  const windowsRun = startHarness({ broker, fenceName, expression: "console.log('WINDOWS_START'); setTimeout(()=>{},600)" });
  let wslRun;
  try {
    await waitUntil(() => windowsRun.output().includes("WINDOWS_START"));
    const encoded = Buffer.from(JSON.stringify({
      host: "127.0.0.1", port: broker.port, fenceName, waitTimeoutMs: 5_000,
      runTimeoutMs: 5_000, bootstrapTimeoutMs: 5_000,
    })).toString("base64url");
    wslRun = spawn(process.execPath, [HARNESS, encoded, "--", "wsl.exe", "bash", "-lc", "printf 'WSL_PROCESS_START'; sleep 0.1"], {
      cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    let output = ""; wslRun.stdout.on("data", (c) => (output += c)); wslRun.stderr.on("data", (c) => (output += c));
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.doesNotMatch(output, /WSL_PROCESS_START/u);
    await windowsRun.exited;
    const result = await new Promise((resolve) => wslRun.once("exit", (code) => resolve({ code, output })));
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /WSL_PROCESS_START/u);
    const bootA = windowsRun.output().match(/"bootIdentity":"([^"]+)"/u)?.[1];
    const bootB = result.output.match(/"bootIdentity":"([^"]+)"/u)?.[1];
    assert.ok(bootA && bootA === bootB, `${windowsRun.output()}\n${result.output}`);
  } finally { await stop(windowsRun.child); await stop(wslRun); await broker.close(); }
});

test("native WSL Linux Node either routes to Windows host or is explicitly unavailable", { skip: process.platform !== "win32" }, (t) => {
  const probe = spawnSync("wsl.exe", ["bash", "-lc", "test -x /usr/bin/node && /usr/bin/node -p process.platform"], {
    encoding: "utf8", windowsHide: true,
  });
  if (probe.status !== 0) {
    t.skip("WSL has no native /usr/bin/node; only Windows node.exe is installed");
    return;
  }
  assert.equal(probe.stdout.trim(), "linux");
  const windowsCli = CLI.replaceAll("\\", "/").replace(/^([A-Za-z]):/u, (_, drive) => `/mnt/${drive.toLowerCase()}`);
  const result = spawnSync("wsl.exe", ["bash", "-lc", `/usr/bin/node '${windowsCli}' -- /bin/true`], {
    encoding: "utf8", windowsHide: true,
  });
  assert.equal(result.status, 78);
  assert.match(`${result.stdout}${result.stderr}`, /GATE_LEASE_WSL_HOST_REQUIRED/u);
});

test("symlink/reparse control replacement has no path surface and production knobs stay fixed", async () => {
  const [guardian, runner, cli, broker, check, posixGuardian] = await Promise.all([
    readFile(path.join(ROOT, "scripts/gate-lease-guardian.ps1"), "utf8"),
    readFile(path.join(ROOT, "scripts/gate-lease-runner.mjs"), "utf8"),
    readFile(path.join(ROOT, "scripts/gate-lease.mjs"), "utf8"),
    readFile(path.join(ROOT, "scripts/gate-lease-broker.mjs"), "utf8"),
    readFile(path.join(ROOT, "scripts/check.sh"), "utf8"),
    readFile(path.join(ROOT, "scripts/gate-lease-guardian.mjs"), "utf8"),
  ]);
  assert.match(guardian, /NamedPipeServerStream/u);
  assert.match(guardian, /PipeSecurity/u);
  assert.match(guardian, /Global\\MoaWork\.FullGate/u);
  assert.match(guardian, /AbandonedMutexException/u);
  assert.match(guardian, /CREATE_SUSPENDED/u);
  assert.match(guardian, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/u);
  assert.doesNotMatch(guardian, /controlPath|taskkill/iu);
  assert.match(guardian, /Read-Broker \$reader 90000/u);
  assert.doesNotMatch(runner, /mkdtemp|control\.json|MOAWORK_GATE_TEST/u);
  assert.doesNotMatch(cli, /MOAWORK_GATE_(?:WAIT|RUN|BOOTSTRAP)/u);
  assert.doesNotMatch(broker, /process\.env|test-endpoint/u);
  assert.match(check, /windows_node_from_wsl/u);
  assert.match(check, /GATE_WSL_BRIDGE_UNPROVEN/u);
  assert.match(posixGuardian, /cgroup v2\/pidfd\/subreaper/u);
  assert.doesNotMatch(posixGuardian, /process\.kill\(-|taskkill/iu);
});
