import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  acquireGateLease,
  createLeaseBroker,
  GateLeaseError,
  verifyGateLease,
} from "./gate-lease-core.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = fileURLToPath(new URL("./gate-lease.mjs", import.meta.url));

async function waitUntil(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("condition timed out");
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function removeTempDir(directory) {
  const deadline = Date.now() + 2_000;
  for (;;) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code !== "EBUSY" || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

function startCli({ port, cwd, expression, waitTimeoutMs = 3_000, runTimeoutMs = 3_000 }) {
  const child = spawn(process.execPath, [CLI, "--", process.execPath, "-e", expression], {
    cwd,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      MOAWORK_GATE_LEASE_PORT: String(port),
      MOAWORK_GATE_WAIT_TIMEOUT_MS: String(waitTimeoutMs),
      MOAWORK_GATE_RUN_TIMEOUT_MS: String(runTimeoutMs),
      MOAWORK_GATE_DIAGNOSTIC_INTERVAL_MS: "40",
      MOAWORK_GATE_BROKER_IDLE_MS: "250",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  return { child, exited, output: () => output };
}

async function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    process.kill(-child.pid, "SIGKILL");
  }
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

test("machine broker grants one heavyweight gate at a time in FIFO order", async () => {
  const broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 20, idleTimeoutMs: -1 });
  try {
    const order = [];
    const first = await acquireGateLease({ port: broker.port, requestId: "first", label: "clone-a" });
    order.push("first");
    const diagnostics = [];
    const secondPromise = acquireGateLease({
      port: broker.port,
      requestId: "second",
      label: "worktree-b",
      onWaiting: (message) => diagnostics.push(message),
    }).then((lease) => {
      order.push("second");
      return lease;
    });
    await waitUntil(() => broker.snapshot().queued.length === 1);
    const thirdPromise = acquireGateLease({
      port: broker.port,
      requestId: "third",
      label: "ci-runner",
    }).then((lease) => {
      order.push("third");
      return lease;
    });
    await waitUntil(() => broker.snapshot().queued.length === 2);
    await waitUntil(() => diagnostics.length > 0);
    assert.deepEqual(
      {
        position: diagnostics[0].position,
        ownerPid: diagnostics[0].owner.pid,
        ownerLabel: diagnostics[0].owner.label,
      },
      { position: 1, ownerPid: process.pid, ownerLabel: "clone-a" },
    );

    first.release();
    const second = await secondPromise;
    assert.deepEqual(order, ["first", "second"]);
    assert.equal(broker.snapshot().active.requestId, "second");
    second.release();
    const third = await thirdPromise;
    assert.deepEqual(order, ["first", "second", "third"]);
    third.release();
    await waitUntil(() => broker.snapshot().active === null);
  } finally {
    await broker.close();
  }
});

test("duplicate request is rejected and bounded wait never hangs", async () => {
  const broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 20, idleTimeoutMs: -1 });
  try {
    const owner = await acquireGateLease({ port: broker.port, requestId: "same", label: "owner" });
    await assert.rejects(
      acquireGateLease({ port: broker.port, requestId: "same", label: "duplicate", waitTimeoutMs: 500 }),
      (error) => error instanceof GateLeaseError && error.code === "DUPLICATE_REQUEST",
    );
    await assert.rejects(
      acquireGateLease({ port: broker.port, requestId: "timeout", label: "waiter", waitTimeoutMs: 80 }),
      (error) => error instanceof GateLeaseError && error.code === "GATE_LEASE_TIMEOUT",
    );
    owner.release();
  } finally {
    await broker.close();
  }
});

test("only the broker-issued active token can enter the inner full gate", async () => {
  const broker = await createLeaseBroker({ port: 0, idleTimeoutMs: -1 });
  try {
    const owner = await acquireGateLease({ port: broker.port, requestId: "token-owner", label: "owner" });
    assert.equal(await verifyGateLease({ port: broker.port, leaseToken: owner.leaseToken }), true);
    assert.equal(await verifyGateLease({ port: broker.port, leaseToken: "manual-bypass" }), false);
    owner.release();
    await waitUntil(() => broker.snapshot().active === null);
    assert.equal(await verifyGateLease({ port: broker.port, leaseToken: owner.leaseToken }), false);
  } finally {
    await broker.close();
  }
});

test("focused command remains runnable while the full-gate lease is occupied", async () => {
  const broker = await createLeaseBroker({ port: 0, idleTimeoutMs: -1 });
  try {
    const owner = await acquireGateLease({ port: broker.port, requestId: "heavy", label: "full-gate" });
    const startedAt = Date.now();
    const focused = spawn(process.execPath, ["-e", "process.stdout.write('focused-pass')"], {
      env: { ...process.env, MOAWORK_GATE_LEASE_PORT: String(broker.port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    focused.stdout.on("data", (chunk) => (output += chunk));
    const exit = await new Promise((resolve) => focused.once("exit", resolve));
    assert.equal(exit, 0);
    assert.equal(output, "focused-pass");
    assert.ok(Date.now() - startedAt < 1_000, "focused command must not enter the heavyweight queue");
    owner.release();
  } finally {
    await broker.close();
  }
});

test("owner process-tree crash releases the OS connection and the next clone recovers", async () => {
  const port = await unusedPort();
  const firstCwd = await mkdtemp(path.join(os.tmpdir(), "moawork-gate-clone-a-"));
  const secondCwd = await mkdtemp(path.join(os.tmpdir(), "moawork-gate-clone-b-"));
  const owner = startCli({
    port,
    cwd: firstCwd,
    expression: "console.log('OWNER_READY:' + process.pid); setInterval(() => {}, 1000)",
    runTimeoutMs: 5_000,
  });
  let waiter;
  try {
    await waitUntil(() => owner.output().includes("GATE_LEASE_ACQUIRED") && owner.output().includes("OWNER_READY"));
    waiter = startCli({ port, cwd: secondCwd, expression: "console.log('WAITER_RAN')" });
    await waitUntil(() => waiter.output().includes("GATE_LEASE_WAIT"));
    assert.match(waiter.output(), /"ownerElapsedMs":\d+/u);
    const ownerCommandPid = Number(owner.output().match(/OWNER_READY:(\d+)/u)?.[1]);
    assert.ok(ownerCommandPid > 0);
    owner.child.kill("SIGKILL");
    await owner.exited;
    const waiterExit = await waiter.exited;
    assert.equal(waiterExit.code, 0, waiter.output());
    assert.match(waiter.output(), /GATE_LEASE_ACQUIRED/u);
    assert.match(waiter.output(), /WAITER_RAN/u);
    assert.throws(() => process.kill(ownerCommandPid, 0), /ESRCH|not found|no such process|invalid argument/iu);
  } finally {
    await killTree(owner.child);
    if (waiter) await killTree(waiter.child);
    await removeTempDir(firstCwd);
    await removeTempDir(secondCwd);
  }
});

test("duplicate broker startup serializes commands without an address collision", async () => {
  const port = await unusedPort();
  const cwdA = await mkdtemp(path.join(os.tmpdir(), "moawork-gate-start-a-"));
  const cwdB = await mkdtemp(path.join(os.tmpdir(), "moawork-gate-start-b-"));
  const first = startCli({ port, cwd: cwdA, expression: "setTimeout(() => console.log('A'), 80)" });
  const second = startCli({ port, cwd: cwdB, expression: "console.log('B')" });
  try {
    const [firstExit, secondExit] = await Promise.all([first.exited, second.exited]);
    assert.equal(firstExit.code, 0, first.output());
    assert.equal(secondExit.code, 0, second.output());
    assert.doesNotMatch(`${first.output()}${second.output()}`, /EADDRINUSE/u);
  } finally {
    await killTree(first.child);
    await killTree(second.child);
    await removeTempDir(cwdA);
    await removeTempDir(cwdB);
  }
});

test("run timeout kills the command tree and returns a structured failure", async () => {
  const port = await unusedPort();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "moawork-gate-timeout-"));
  const timedOut = startCli({
    port,
    cwd,
    expression: "setInterval(() => {}, 1000)",
    runTimeoutMs: 120,
  });
  try {
    const result = await timedOut.exited;
    assert.equal(result.code, 124, timedOut.output());
    assert.match(timedOut.output(), /GATE_LEASE_RUN_TIMEOUT/u);
    const recovered = startCli({ port, cwd, expression: "console.log('RECOVERED')" });
    const recoveredExit = await recovered.exited;
    assert.equal(recoveredExit.code, 0, recovered.output());
    assert.match(recovered.output(), /RECOVERED/u);
  } finally {
    await killTree(timedOut.child);
    await removeTempDir(cwd);
  }
});

test("Windows self-hosted WSL handoff preserves the broker-issued token", { skip: process.platform !== "win32" }, async () => {
  const port = await unusedPort();
  const child = spawn(
    process.execPath,
    [
      CLI,
      "--",
      "wsl.exe",
      "bash",
      "-lc",
      "node scripts/gate-lease.mjs --verify-held && printf WSL_TOKEN_OK",
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        MOAWORK_GATE_LEASE_PORT: String(port),
        MOAWORK_GATE_BROKER_IDLE_MS: "250",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const code = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(code, 0, output);
  assert.match(output, /WSL_TOKEN_OK/u);
});

test("canonical full gate and CI enforce one lease while visual ports stay ephemeral", async () => {
  const [checkScript, workflow, visualGate] = await Promise.all([
    readFile(path.join(ROOT, "scripts/check.sh"), "utf8"),
    readFile(path.join(ROOT, ".github/workflows/ci.yml"), "utf8"),
    readFile(path.join(ROOT, "docs/design/qa-visual-blocks.mjs"), "utf8"),
  ]);
  assert.match(checkScript, /MOAWORK_GATE_LEASE_TOKEN/u);
  assert.match(checkScript, /gate-lease\.mjs --verify-held/u);
  assert.match(checkScript, /wsl\.exe bash scripts\/check\.sh/u);
  assert.match(checkScript, /exec node scripts\/gate-lease\.mjs -- "\$bash_bin" scripts\/check\.sh/u);
  const leaseCli = await readFile(CLI, "utf8");
  assert.match(leaseCli, /gate-lease-watch\.mjs/u);
  assert.match(leaseCli, /MOAWORK_GATE_LEASE_TOKEN\/u/u);
  assert.doesNotMatch(workflow, /cancel-in-progress:\s+true/u);
  assert.match(workflow, /run:\s+bash scripts\/check\.sh/u);
  assert.match(visualGate, /async function freePort\(\)/u);
  assert.match(visualGate, /await freePort\(\)/u);
  assert.doesNotMatch(visualGate, /port\s*=\s*4317/u);
});
