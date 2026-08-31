import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
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
const GUARDIAN = fileURLToPath(new URL("./gate-lease-guardian.ps1", import.meta.url));

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

function invalidNonce(kind, nonce) {
  if (kind === "array") return [nonce];
  if (kind === "null") return null;
  if (kind === "number") return 1;
  if (kind === "soft-hyphen") return `${nonce.slice(0, 1)}\u00ad${nonce.slice(1)}`;
  if (kind === "zwj") return `${nonce.slice(0, 1)}\u200d${nonce.slice(1)}`;
  if (kind === "nul") return `${nonce.slice(0, 1)}\u0000${nonce.slice(1)}`;
  const variant = nonce.replace(/[a-z]/u, (letter) => letter.toUpperCase());
  assert.notEqual(variant, nonce, "nonce fixture needs an alphabetic character");
  return variant;
}

async function connectNamedPipe(pipePath, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = net.createConnection(pipePath);
        socket.once("connect", () => resolve(socket));
        socket.once("error", reject);
      });
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

function lineChannel(socket) {
  socket.setEncoding("utf8");
  let buffer = "";
  const messages = [];
  const waiters = [];
  socket.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(message);
      else messages.push(message);
    }
  });
  return {
    send(message) { socket.write(`${JSON.stringify(message)}\n`); },
    next(timeoutMs = 5_000) {
      if (messages.length) return Promise.resolve(messages.shift());
      return new Promise((resolve, reject) => {
        const waiter = { resolve: (message) => { clearTimeout(timer); resolve(message); } };
        waiters.push(waiter);
        const timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error("timed out waiting for pipe message"));
        }, timeoutMs);
      });
    },
    close() { socket.destroy(); },
  };
}

async function startDirectGuardian({ broker, fenceName, envelopeNonce, controlNonce }) {
  const nonce = `nonce-aa-${randomUUID()}`;
  const pipeName = `moawork-gate-${randomUUID()}`;
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const guardian = spawn(powershell, [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", GUARDIAN,
    "-PipeName", pipeName,
    "-PipeNonce", nonce,
    "-BootstrapWrapperPid", String(process.pid),
  ], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let output = "";
  guardian.stdout.on("data", (chunk) => (output += chunk));
  guardian.stderr.on("data", (chunk) => (output += chunk));
  const exited = new Promise((resolve) => guardian.once("exit", (code, signal) => resolve({ code, signal })));
  const socket = await connectNamedPipe(`\\\\.\\pipe\\${pipeName}`);
  const channel = lineChannel(socket);
  const requestId = randomUUID();
  channel.send({
    type: "payload",
    nonce: envelopeNonce ? invalidNonce(envelopeNonce, nonce) : nonce,
    payload: {
      protocol: "moawork-gate-guardian-v2",
      host: "127.0.0.1",
      port: broker.port,
      fenceName,
      requestId,
      label: "nonce-fixture",
      command: process.execPath,
      args: ["-e", "console.log('NONCE_CHILD_STARTED'); setInterval(() => {}, 1000)"],
      cwd: ROOT,
      waitTimeoutMs: 5_000,
      runTimeoutMs: 10_000,
      wrapperPid: process.pid,
    },
  });
  if (controlNonce) {
    const ready = await channel.next();
    assert.equal(ready.type, "ready", output);
    await waitUntil(() => output.includes("NONCE_CHILD_STARTED"));
  }
  return {
    guardian,
    exited,
    channel,
    output: () => output,
    sendInvalidControl() {
      assert.ok(controlNonce, "control nonce fixture was not configured");
      channel.send({ type: "signal", nonce: invalidNonce(controlNonce, nonce), signal: "SIGTERM" });
    },
  };
}

function markerExists(fenceName) {
  if (process.platform !== "win32") return false;
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = [
    "$sha=[Security.Cryptography.SHA256]::Create()",
    "$name=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($args[0])))).Replace('-','')",
    "$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\MoaWork\\GateLeaseTest')",
    "if($null -ne $key -and $null -ne $key.GetValue($name,$null)){exit 1}else{exit 0}",
  ].join(";");
  return spawnSync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script, fenceName], {
    windowsHide: true,
  }).status === 1;
}

async function rawLeaseClient(port, requestId) {
  const socket = net.createConnection({ host: "127.0.0.1", port });
  socket.setEncoding("utf8");
  let buffer = "";
  const messages = [];
  const waiters = [];
  const dispatch = (message) => {
    const index = waiters.findIndex(({ type }) => message.type === type);
    if (index >= 0) waiters.splice(index, 1)[0].resolve(message);
    else messages.push(message);
  };
  socket.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim()) dispatch(JSON.parse(line));
    }
  });
  socket.on("error", () => {});
  const next = (type, timeoutMs = 1_000) => {
    const index = messages.findIndex((message) => message.type === type);
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { type, resolve: (message) => { clearTimeout(timer); resolve(message); } };
      waiters.push(waiter);
      const timer = setTimeout(() => {
        const pending = waiters.indexOf(waiter);
        if (pending >= 0) waiters.splice(pending, 1);
        reject(new Error(`timed out waiting for ${type}`));
      }, timeoutMs);
    });
  };
  await next("hello");
  socket.write(`${JSON.stringify({ type: "acquire", request: { requestId, pid: process.pid, label: requestId } })}\n`);
  await next("granted");
  return {
    socket,
    next,
    send(message) { socket.write(`${JSON.stringify(message)}\n`); },
    sendRaw(value) { socket.write(value); },
  };
}

async function createMalformedGuardianBroker(phase) {
  const sockets = new Set();
  let closed = false;
  let releaseCompleteCount = 0;
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    if (phase === "HELLO") socket.write("{malformed-hello\n");
    else socket.write(`${JSON.stringify({ type: "hello", protocol: "moawork-full-gate-v1" })}\n`);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.type === "acquire") {
          if (phase === "WAIT") socket.write("{malformed-wait\n");
          else if (phase.startsWith("WAIT_")) socket.write(`${JSON.stringify({
            type: "granted",
            requestId: invalidNonce(phase.slice("WAIT_".length).toLowerCase().replaceAll("_", "-"), message.request.requestId),
            acquiredAt: Date.now(),
            leaseToken: "malformed-fixture-token",
          })}\n`);
          else socket.write(`${JSON.stringify({
            type: "granted",
            requestId: message.request.requestId,
            acquiredAt: Date.now(),
            leaseToken: "malformed-fixture-token",
          })}\n`);
        } else if (message.type === "release") {
          if (phase === "RELEASE") socket.write("{malformed-release\n");
          else if (phase === "RELEASE_ARRAY") socket.write(`${JSON.stringify({ type: "released", requestId: [message.requestId] })}\n`);
          else if (phase === "RELEASE_NULL") socket.write(`${JSON.stringify({ type: "released", requestId: null })}\n`);
          else if (phase === "RELEASE_NUMBER") socket.write(`${JSON.stringify({ type: "released", requestId: 1 })}\n`);
          else if (phase === "RELEASE_CASE_VARIANT") {
            const requestId = message.requestId.replace(/[a-z]/u, (letter) => letter.toUpperCase());
            assert.notEqual(requestId, message.requestId, "fixture requestId needs an alphabetic character");
            socket.write(`${JSON.stringify({ type: "released", requestId })}\n`);
          }
          else if (phase.startsWith("RELEASE_")) socket.write(`${JSON.stringify({
            type: "released",
            requestId: invalidNonce(phase.slice("RELEASE_".length).toLowerCase().replaceAll("_", "-"), message.requestId),
          })}\n`);
        } else if (message.type === "release-complete") {
          releaseCompleteCount += 1;
        }
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    port: server.address().port,
    get releaseCompleteCount() { return releaseCompleteCount; },
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
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

test("clean release handshake stays FIFO across 100 queued successors", async () => {
  const broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 5, idleTimeoutMs: -1 });
  try {
    for (let index = 0; index < 100; index += 1) {
      const first = await acquireGateLease({ port: broker.port, requestId: `first-${index}`, label: "first" });
      const secondPromise = acquireGateLease({ port: broker.port, requestId: `second-${index}`, label: "second" });
      await waitUntil(() => broker.snapshot().queued.length === 1);
      first.release();
      const second = await secondPromise;
      assert.equal(broker.snapshot().active?.requestId, `second-${index}`);
      second.release();
      assert.equal(await second.lost, null);
      assert.equal(broker.snapshot().active, null);
    }
  } finally { await broker.close(); }
});

test("broker grants only after released acknowledgement and clean peer close", async () => {
  const broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 5, idleTimeoutMs: -1, crashRecoveryDelayMs: 300 });
  const first = await rawLeaseClient(broker.port, "clean-owner");
  let second;
  try {
    const secondPromise = acquireGateLease({ port: broker.port, requestId: "clean-successor", label: "successor" });
    await waitUntil(() => broker.snapshot().queued.length === 1);
    first.send({ type: "release", requestId: "clean-owner" });
    assert.equal((await first.next("released")).requestId, "clean-owner");
    first.send({ type: "release-complete", requestId: "clean-owner" });
    first.socket.end();
    second = await Promise.race([
      secondPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("clean successor was recovery-delayed")), 150)),
    ]);
    second.release();
    assert.equal(await second.lost, null);
  } finally {
    first.socket.destroy();
    await broker.close();
  }
});

test("post-completion protocol errors always force crash recovery", async () => {
  for (const mode of ["duplicate", "wrong-request", "same-chunk"]) {
    const recoveryMs = 250;
    const broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 5, idleTimeoutMs: -1, crashRecoveryDelayMs: recoveryMs });
    const requestId = `${mode}-owner`;
    const first = await rawLeaseClient(broker.port, requestId);
    let second;
    try {
      let grantedAt = 0;
      const secondPromise = acquireGateLease({ port: broker.port, requestId: `${mode}-successor`, label: "successor" })
        .then((lease) => { grantedAt = Date.now(); return lease; });
      await waitUntil(() => broker.snapshot().queued.length === 1);
      first.send({ type: "release", requestId });
      await first.next("released");
      const invalidAt = Date.now();
      const complete = `${JSON.stringify({ type: "release-complete", requestId })}\n`;
      const invalid = `${JSON.stringify({
        type: "release-complete",
        requestId: mode === "wrong-request" ? `${requestId}-wrong` : requestId,
      })}\n`;
      if (mode === "same-chunk") first.sendRaw(complete + invalid);
      else {
        first.send({ type: "release-complete", requestId });
        first.sendRaw(invalid);
      }
      assert.equal((await first.next("error")).code, "INVALID_RELEASE_COMPLETE");
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(grantedAt, 0, `${mode} granted a successor before crash recovery`);
      second = await secondPromise;
      assert.ok(grantedAt - invalidAt >= recoveryMs - 40, `${mode} recovery delay was ${grantedAt - invalidAt}ms`);
      second.release();
      assert.equal(await second.lost, null);
    } finally {
      first.socket.destroy();
      await broker.close();
    }
  }
});

test("peer close before acknowledgement and reset after acknowledgement both fail closed", async () => {
  for (const mode of ["before-ack", "reset-after-ack"]) {
    const broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 5, idleTimeoutMs: -1, crashRecoveryDelayMs: 250 });
    const first = await rawLeaseClient(broker.port, `${mode}-owner`);
    let second;
    try {
      let granted = false;
      const secondPromise = acquireGateLease({ port: broker.port, requestId: `${mode}-successor`, label: "successor" })
        .then((lease) => { granted = true; return lease; });
      await waitUntil(() => broker.snapshot().queued.length === 1);
      if (mode === "before-ack") {
        first.send({ type: "release", requestId: `${mode}-owner` });
        first.socket.end();
      } else {
        first.send({ type: "release", requestId: `${mode}-owner` });
        await first.next("released");
        first.socket.resetAndDestroy();
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(granted, false, `${mode} bypassed crash recovery`);
      second = await secondPromise;
      second.release();
      assert.equal(await second.lost, null);
    } finally {
      first.socket.destroy();
      await broker.close();
    }
  }
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

test("bootstrap and control nonces require exact scalar strings before command or clean release", { skip: process.platform !== "win32" }, async () => {
  for (const phase of ["envelope", "control"]) {
    for (const kind of ["array", "null", "number", "case-variant", "soft-hyphen", "zwj", "nul"]) {
      const broker = await createLeaseBroker({
        port: 0,
        diagnosticIntervalMs: 5,
        idleTimeoutMs: -1,
        crashRecoveryDelayMs: 400,
      });
      const fenceName = testFence();
      cleanupFence(fenceName);
      const failed = await startDirectGuardian({
        broker,
        fenceName,
        ...(phase === "envelope" ? { envelopeNonce: kind } : { controlNonce: kind }),
      });
      let successor;
      try {
        if (phase === "control") {
          successor = startHarness({ broker, fenceName, expression: "console.log('NONCE_RECOVERED')" });
          await waitUntil(() => broker.snapshot().queued.length === 1);
          failed.sendInvalidControl();
        }
        const started = Date.now();
        const result = await failed.exited;
        assert.equal(result.code, 78, failed.output());
        assert.match(failed.output(), phase === "envelope" ? /GATE_PIPE_NONCE_INVALID/u : /GATE_PIPE_CONTROL_SCHEMA/u);
        assert.doesNotMatch(failed.output(), /GATE_LEASE_RELEASED/u);
        if (phase === "envelope") assert.doesNotMatch(failed.output(), /NONCE_CHILD_STARTED/u);
        assert.equal(markerExists(fenceName), false);
        await waitUntil(() => {
          try { process.kill(failed.guardian.pid, 0); return false; } catch { return true; }
        });
        if (phase === "control") {
          assert.equal((await successor.exited).code, 0, successor.output());
          assert.ok(Date.now() - started >= 300, `${kind} successor bypassed recovery`);
          assert.match(successor.output(), /NONCE_RECOVERED/u);
          assert.match(successor.output(), /GATE_LEASE_RELEASED.*"activeProcesses":0/u);
        } else {
          successor = startHarness({ broker, fenceName, expression: "console.log('NONCE_RECOVERED')" });
          assert.equal((await successor.exited).code, 0, successor.output());
          assert.match(successor.output(), /NONCE_RECOVERED/u);
        }
        assert.equal(markerExists(fenceName), false);
        assert.equal(broker.snapshot().active, null);
        assert.deepEqual(broker.snapshot().queued, []);
      } finally {
        failed.channel.close();
        await stop(failed.guardian);
        await stop(successor?.child);
        await broker.close();
        cleanupFence(fenceName);
      }
    }
  }
});

test("Windows guardian clean-close queues successors and preserves child exit codes", { skip: process.platform !== "win32" }, async () => {
  const broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 5, idleTimeoutMs: -1 });
  const fenceName = testFence();
  const temp = await mkdtemp(path.join(os.tmpdir(), "moawork-gate-release-"));
  const releasePath = path.join(temp, "release-first");
  cleanupFence(fenceName);
  const first = startHarness({
    broker,
    fenceName,
    expression: "const fs=require('node:fs'); console.log('FIRST_CHILD'); const hold=setInterval(()=>{if(fs.existsSync(process.argv[1]))clearInterval(hold)},25)",
    args: [releasePath],
    runTimeoutMs: 10_000,
  });
  let second;
  try {
    await waitUntil(() => first.output().includes("FIRST_CHILD"));
    second = startHarness({ broker, fenceName, expression: "console.log('SECOND_CHILD'); process.exit(37)" });
    await waitUntil(() => broker.snapshot().queued.length === 1, 10_000);
    await writeFile(releasePath, "release\n");
    assert.equal((await first.exited).code, 0, first.output());
    assert.equal((await second.exited).code, 37, second.output());
    assert.match(first.output(), /GATE_LEASE_RELEASED.*"activeProcesses":0/u);
    assert.match(second.output(), /GATE_LEASE_RELEASED.*"childExitCode":37/u);
    assert.equal(broker.snapshot().active, null);
    assert.deepEqual(broker.snapshot().queued, []);
    assert.equal(markerExists(fenceName), false);
    for (const output of [first.output(), second.output()]) {
      const guardianPid = Number(output.match(/GATE_GUARDIAN_READY[^\n]*"guardianPid":(\d+)/u)?.[1]);
      assert.ok(guardianPid > 0, output);
      await waitUntil(() => {
        try { process.kill(guardianPid, 0); return false; } catch { return true; }
      });
    }
  } finally {
    await stop(first.child);
    await stop(second?.child);
    await broker.close();
    cleanupFence(fenceName);
    await rm(temp, { recursive: true, force: true });
  }
});

test("forced broker reset uses stable transport code and leaves fence reusable", { skip: process.platform !== "win32" }, async () => {
  let broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 5, idleTimeoutMs: -1 });
  const port = broker.port;
  const fenceName = testFence();
  cleanupFence(fenceName);
  const first = startHarness({
    broker,
    fenceName,
    expression: "console.log('RESET_READY'); setTimeout(() => {}, 150)",
  });
  let second;
  try {
    await waitUntil(() => first.output().includes("RESET_READY"));
    await broker.close();
    const failed = await first.exited;
    assert.equal(failed.code, 78, first.output());
    assert.match(first.output(), /GATE_BROKER_(?:WRITE_FAILED|READ_FAILED|RELEASE_EOF)/u);
    assert.doesNotMatch(first.output(), /GATE_GUARDIAN_INTERNAL/u);
    assert.equal(markerExists(fenceName), false);

    broker = await createLeaseBroker({ port, diagnosticIntervalMs: 5, idleTimeoutMs: -1 });
    second = startHarness({ broker, fenceName, expression: "console.log('RESET_RECOVERED')" });
    assert.equal((await second.exited).code, 0, second.output());
    assert.match(second.output(), /RESET_RECOVERED/u);
    assert.equal(markerExists(fenceName), false);
    assert.equal(broker.snapshot().active, null);
  } finally {
    await stop(first.child);
    await stop(second?.child);
    await broker.close();
    cleanupFence(fenceName);
  }
});

test("guardian broker JSON and request schema failures use phase codes and leave no marker, fence, or process", { skip: process.platform !== "win32" }, async () => {
  for (const fixture of [
    "HELLO", "WAIT", "WAIT_SOFT_HYPHEN", "WAIT_ZWJ", "WAIT_NUL",
    "RELEASE", "RELEASE_ARRAY", "RELEASE_NULL", "RELEASE_NUMBER", "RELEASE_CASE_VARIANT",
    "RELEASE_SOFT_HYPHEN", "RELEASE_ZWJ", "RELEASE_NUL",
  ]) {
    const phase = fixture.startsWith("RELEASE_") ? "RELEASE" : fixture.startsWith("WAIT_") ? "WAIT" : fixture;
    const failure = fixture === phase ? "MALFORMED" : "SCHEMA";
    const malformed = await createMalformedGuardianBroker(fixture);
    const fenceName = testFence();
    cleanupFence(fenceName);
    const first = startHarness({
      broker: malformed,
      fenceName,
      expression: "console.log('PROTOCOL_CHILD_STARTED')",
    });
    let successorBroker;
    let successor;
    try {
      const result = await first.exited;
      assert.equal(result.code, 78, first.output());
      assert.match(first.output(), new RegExp(`GATE_BROKER_${phase}_${failure}`, "u"));
      assert.doesNotMatch(first.output(), /GATE_GUARDIAN_INTERNAL|ConvertFrom-Json|Unexpected character|Invalid JSON/u);
      if (phase === "RELEASE") assert.match(first.output(), /PROTOCOL_CHILD_STARTED/u);
      else assert.doesNotMatch(first.output(), /PROTOCOL_CHILD_STARTED/u);
      assert.equal(malformed.releaseCompleteCount, 0, `${fixture} sent release-complete`);
      assert.equal(markerExists(fenceName), false);
      const guardianPid = Number(first.output().match(/GATE_GUARDIAN_READY[^\n]*"guardianPid":(\d+)/u)?.[1]);
      assert.ok(guardianPid > 0, first.output());
      await waitUntil(() => {
        try { process.kill(guardianPid, 0); return false; } catch { return true; }
      });
      const port = malformed.port;
      await malformed.close();
      successorBroker = await createLeaseBroker({ port, diagnosticIntervalMs: 5, idleTimeoutMs: -1 });
      successor = startHarness({ broker: successorBroker, fenceName, expression: "console.log('PROTOCOL_RECOVERED')" });
      assert.equal((await successor.exited).code, 0, successor.output());
      assert.match(successor.output(), /PROTOCOL_RECOVERED/u);
      assert.match(successor.output(), /GATE_LEASE_RELEASED.*"activeProcesses":0/u);
      assert.equal(markerExists(fenceName), false);
    } finally {
      await stop(first.child);
      await stop(successor?.child);
      if (successorBroker) await successorBroker.close();
      else await malformed.close();
      cleanupFence(fenceName);
    }
  }
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

test("WSL full-gate entry fails closed before any product command", { skip: process.platform !== "win32" }, () => {
  const hasWsl = spawnSync("wsl.exe", ["bash", "-lc", "uname -r"], { encoding: "utf8", windowsHide: true });
  assert.equal(hasWsl.status, 0, `${hasWsl.stdout}${hasWsl.stderr}`);
  const wslRoot = ROOT.replaceAll("\\", "/").replace(/^([A-Za-z]):/u, (_, drive) => `/mnt/${drive.toLowerCase()}`);
  const result = spawnSync("wsl.exe", ["bash", "-lc", `cd '${wslRoot}' && bash scripts/check.sh`], {
    encoding: "utf8", windowsHide: true,
  });
  assert.equal(result.status, 78, `${result.stdout}${result.stderr}`);
  assert.match(`${result.stdout}${result.stderr}`, /GATE_WSL_CONTAINMENT_UNAVAILABLE/u);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /customer-specific values|GATE_GUARDIAN_READY/u);
});

test("production CLI starts zero detached WSL descendants", { skip: process.platform !== "win32" }, () => {
  const marker = `BBE614_BLOCKED_${randomUUID().replaceAll("-", "")}`;
  const exploit = `nohup bash -c 'exec -a ${marker} sleep 30' >/dev/null 2>&1 & wait`;
  const result = spawnSync(process.execPath, [CLI, "--", "wsl.exe", "bash", "-lc", exploit], {
    cwd: ROOT, encoding: "utf8", windowsHide: true,
  });
  assert.equal(result.status, 78, `${result.stdout}${result.stderr}`);
  assert.match(`${result.stdout}${result.stderr}`, /GATE_WSL_CONTAINMENT_UNAVAILABLE/u);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /GATE_GUARDIAN_READY|GATE_FENCE_ACQUIRED/u);
  const residual = spawnSync("wsl.exe", ["bash", "-lc", `pgrep -f '^${marker} 30$' || true`], {
    encoding: "utf8", windowsHide: true,
  });
  assert.equal(residual.status, 0, `${residual.stdout}${residual.stderr}`);
  assert.equal(residual.stdout.trim(), "");
});

test("native WSL Linux Node fails closed or is explicitly unavailable", { skip: process.platform !== "win32" }, (t) => {
  const probe = spawnSync("wsl.exe", ["bash", "-lc", "test -x /usr/bin/node && /usr/bin/node -p process.platform"], {
    encoding: "utf8", windowsHide: true,
  });
  if (probe.status !== 0) {
    t.skip("WSL has no native /usr/bin/node; fail-closed runtime probe not run");
    return;
  }
  assert.equal(probe.stdout.trim(), "linux");
  const windowsCli = CLI.replaceAll("\\", "/").replace(/^([A-Za-z]):/u, (_, drive) => `/mnt/${drive.toLowerCase()}`);
  const result = spawnSync("wsl.exe", ["bash", "-lc", `/usr/bin/node '${windowsCli}' -- /bin/true`], {
    encoding: "utf8", windowsHide: true,
  });
  assert.equal(result.status, 78);
  assert.match(`${result.stdout}${result.stderr}`, /GATE_WSL_CONTAINMENT_UNAVAILABLE/u);
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
  assert.match(guardian, /Read-BrokerMessage \$reader 90000 "WAIT"/u);
  assert.doesNotMatch(runner, /mkdtemp|control\.json|MOAWORK_GATE_TEST/u);
  assert.doesNotMatch(cli, /MOAWORK_GATE_(?:WAIT|RUN|BOOTSTRAP)/u);
  assert.doesNotMatch(broker, /process\.env|test-endpoint/u);
  assert.match(check, /GATE_WSL_CONTAINMENT_UNAVAILABLE/u);
  assert.doesNotMatch(check, /windows_node_from_wsl|exec [^\n]*wsl\.exe/u);
  assert.match(runner, /GATE_WSL_CONTAINMENT_UNAVAILABLE/u);
  assert.doesNotMatch(guardian, /WSLENV/u);
  assert.match(posixGuardian, /cgroup v2\/pidfd\/subreaper/u);
  assert.doesNotMatch(posixGuardian, /process\.kill\(-|taskkill/iu);
});
