import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// CI 가 Windows 러너에서 WSL 부트스트랩(우분투 rootfs 내려받기 + import)을 하느라 시간과
// 과금 분을 크게 썼다. 아래 세 테스트만 실제로 wsl.exe 를 필요로 하므로, WSL 이 없으면
// **실패가 아니라 건너뛰기**로 만든다. WSL 이 있는 환경(개발자 PC)에서는 그대로 돈다.
const WSL_AVAILABLE = process.platform === "win32"
  && spawnSync("wsl.exe", ["bash", "-lc", "true"], { windowsHide: true, encoding: "utf8" }).status === 0;

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

test("test cleanup cannot address the production fence namespace", { skip: process.platform !== "win32" }, () => {
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const invoke = (args) => spawnSync(powershell, [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", CLEANUP, ...args,
  ], { encoding: "utf8", windowsHide: true });
  for (const fenceName of [
    "",
    "Global\\MoaWork.FullGate.v1",
    "Global\\MoaWork.FullGate.Test",
    "Global\\MoaWork.FullGate.TestLike.value",
    "global\\MoaWork.FullGate.Test.value",
  ]) {
    const run = invoke(["-FenceName", fenceName]);
    assert.equal(run.status, 78, `${fenceName}: ${run.stdout}${run.stderr}`);
    assert.match(`${run.stdout}${run.stderr}`, /GATE_TEST_CLEANUP_SCOPE_INVALID/u);
  }
  const conflicting = invoke(["-AllTests", "-FenceName", "Global\\MoaWork.FullGate.v1"]);
  assert.equal(conflicting.status, 78, `${conflicting.stdout}${conflicting.stderr}`);
  assert.equal(invoke(["-FenceName", testFence()]).status, 0);
  assert.equal(invoke(["-AllTests"]).status, 0);
});

async function startAbandonedFenceOwner(fenceName) {
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = [
    "$name=$args[0]",
    "$created=$false",
    "$mutex=[Threading.Mutex]::new($false,$name,[ref]$created)",
    "$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User",
    "$security=[Security.AccessControl.MutexSecurity]::new()",
    "$security.SetOwner($sid)",
    "$security.SetAccessRuleProtection($true,$false)",
    "$security.AddAccessRule([Security.AccessControl.MutexAccessRule]::new($sid,[Security.AccessControl.MutexRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow))",
    "$mutex.SetAccessControl($security)",
    "[void]$mutex.WaitOne()",
    "[Console]::Out.WriteLine('FENCE_OWNER_READY')",
    "[Console]::Out.Flush()",
    "Start-Sleep -Seconds 60",
  ].join(";");
  const child = spawn(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script, fenceName], {
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const exited = new Promise((resolve) => child.once("exit", resolve));
  await waitUntil(() => output.includes("FENCE_OWNER_READY"));
  return { child, exited };
}

async function startLiveFenceOwner(fenceName, holdMs = 8_000) {
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = [
    "$name=$env:MOAWORK_TEST_LIVE_FENCE_NAME",
    "$created=$false",
    "$mutex=[Threading.Mutex]::new($false,$name,[ref]$created)",
    "$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User",
    "$security=[Security.AccessControl.MutexSecurity]::new()",
    "$security.SetOwner($sid)",
    "$security.SetAccessRuleProtection($true,$false)",
    "$security.AddAccessRule([Security.AccessControl.MutexAccessRule]::new($sid,[Security.AccessControl.MutexRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow))",
    "$mutex.SetAccessControl($security)",
    "[void]$mutex.WaitOne()",
    "[Console]::Out.WriteLine('FENCE_OWNER_READY')",
    "[Console]::Out.Flush()",
    "Start-Sleep -Milliseconds ([int]$env:MOAWORK_TEST_LIVE_FENCE_HOLD_MS)",
    "$mutex.ReleaseMutex()",
    "$mutex.Dispose()",
  ].join(";");
  const child = spawn(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    env: { ...process.env, MOAWORK_TEST_LIVE_FENCE_NAME: fenceName, MOAWORK_TEST_LIVE_FENCE_HOLD_MS: String(holdMs) },
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const exited = new Promise((resolve) => child.once("exit", resolve));
  await waitUntil(() => output.includes("FENCE_OWNER_READY")).catch(() => {
    throw new Error(`live fence owner failed to start: ${output}`);
  });
  return { child, exited };
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

async function settlesWithin(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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

function observeGuardianLifecycle(guardian, marker) {
  let output = "";
  let order = 0;
  let markerEvent = null;
  let closeEvent = null;
  let resolveMarker;
  let resolveClose;
  const markerObserved = new Promise((resolve) => { resolveMarker = resolve; });
  const closed = new Promise((resolve) => { resolveClose = resolve; });
  const onData = (chunk) => {
    output += chunk;
    if (!markerEvent && output.includes(marker)) {
      markerEvent = { type: "marker", order: ++order };
      resolveMarker(markerEvent);
    }
  };
  guardian.stdout.on("data", onData);
  guardian.stderr.on("data", onData);
  guardian.once("close", (code, signal) => {
    closeEvent = { type: "close", order: ++order, code, signal };
    guardian.stdout.off("data", onData);
    guardian.stderr.off("data", onData);
    resolveClose(closeEvent);
  });
  return {
    closed,
    markerObserved,
    markerEvent: () => markerEvent,
    closeEvent: () => closeEvent,
    output: () => output,
  };
}

async function waitForGuardianOutput(lifecycle) {
  const chooseFirst = () => {
    const marker = lifecycle.markerEvent();
    const close = lifecycle.closeEvent();
    if (marker && (!close || marker.order < close.order)) return marker;
    if (close && (!marker || close.order < marker.order)) return close;
    return null;
  };
  let result = chooseFirst();
  if (!result) {
    await Promise.race([lifecycle.markerObserved, lifecycle.closed]);
    result = chooseFirst();
  }
  if (result?.type === "close") {
    throw new Error(`DIRECT_GUARDIAN_CLOSED_BEFORE_CHILD_START code=${result.code} signal=${result.signal}\n${lifecycle.output()}`);
  }
}

test("guardian output milestone is bound to its pre-registered close event", async () => {
  const fakeGuardian = () => Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
  const closedGuardian = fakeGuardian();
  const closedLifecycle = observeGuardianLifecycle(closedGuardian, "NONCE_CHILD_STARTED");
  closedGuardian.emit("close", 78, null);
  await assert.rejects(
    waitForGuardianOutput(closedLifecycle),
    /DIRECT_GUARDIAN_CLOSED_BEFORE_CHILD_START code=78 signal=null/u,
  );
  assert.equal(closedGuardian.stdout.listenerCount("data"), 0);
  assert.equal(closedGuardian.stderr.listenerCount("data"), 0);

  const markerGuardian = fakeGuardian();
  const markerLifecycle = observeGuardianLifecycle(markerGuardian, "NONCE_CHILD_STARTED");
  markerGuardian.stdout.emit("data", Buffer.from("NONCE_CHILD_STARTED:1234\n"));
  markerGuardian.emit("close", 78, null);
  await waitForGuardianOutput(markerLifecycle);
  assert.equal(markerGuardian.stdout.listenerCount("data"), 0);
  assert.equal(markerGuardian.stderr.listenerCount("data"), 0);

  const closeFirstGuardian = fakeGuardian();
  const closeFirstLifecycle = observeGuardianLifecycle(closeFirstGuardian, "NONCE_CHILD_STARTED");
  closeFirstGuardian.emit("close", 78, "SIGKILL");
  closeFirstGuardian.stdout.emit("data", Buffer.from("NONCE_CHILD_STARTED:late\n"));
  await assert.rejects(waitForGuardianOutput(closeFirstLifecycle), /DIRECT_GUARDIAN_CLOSED_BEFORE_CHILD_START code=78 signal=SIGKILL/u);
  assert.equal(closeFirstGuardian.stdout.listenerCount("data"), 0);
  assert.equal(closeFirstGuardian.stderr.listenerCount("data"), 0);
});

const directGuardianSetupEvidence = new WeakMap();

async function startDirectGuardian({
  broker,
  fenceName,
  envelopeNonce,
  controlNonce,
  childExpression = "console.log('NONCE_CHILD_STARTED'); setInterval(() => {}, 1000)",
  injectSetupFailureAfterChildStart = false,
  forceSetupCleanupFallback = false,
}) {
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
  const lifecycle = observeGuardianLifecycle(guardian, "NONCE_CHILD_STARTED");
  const exited = new Promise((resolve) => guardian.once("exit", (code, signal) => resolve({ code, signal })));
  const { closed } = lifecycle;
  let channel;
  try {
    const socket = await connectNamedPipe(`\\\\.\\pipe\\${pipeName}`);
    channel = lineChannel(socket);
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
        args: ["-e", childExpression],
        cwd: ROOT,
        waitTimeoutMs: 5_000,
        runTimeoutMs: 10_000,
        wrapperPid: process.pid,
      },
    });
    if (controlNonce) {
      const ready = await channel.next();
      assert.equal(ready.type, "ready", lifecycle.output());
      await waitForGuardianOutput(lifecycle);
      if (injectSetupFailureAfterChildStart) throw new Error("DIRECT_GUARDIAN_SETUP_FAILURE_INJECTED");
    }
    return {
      guardian,
      exited,
      channel,
      output: lifecycle.output,
      sendInvalidControl() {
        assert.ok(controlNonce, "control nonce fixture was not configured");
        channel.send({ type: "signal", nonce: invalidNonce(controlNonce, nonce), signal: "SIGTERM" });
      },
    };
  } catch (error) {
    let closeObserved = false;
    let forced = forceSetupCleanupFallback || !channel;
    let cleanupError = null;
    try {
      channel?.close();
      if (!forced) closeObserved = await settlesWithin(closed, 2_000);
      if (!closeObserved) {
        forced = true;
        await stop(guardian);
        closeObserved = await settlesWithin(closed, 2_000);
      }
    } catch (candidate) {
      cleanupError = candidate;
      try { await stop(guardian); } catch {}
      try { closeObserved ||= await settlesWithin(closed, 2_000); } catch {}
    }
    try {
      if ((typeof error === "object" && error !== null) || typeof error === "function") {
        directGuardianSetupEvidence.set(error, {
          guardianPid: guardian.pid,
          output: lifecycle.output(),
          closeObserved,
          forced,
          cleanupError,
        });
      }
    } catch {}
    throw error;
  }
}

function markerExists(fenceName) {
  if (process.platform !== "win32") return false;
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = [
    "$sha=[Security.Cryptography.SHA256]::Create()",
    "$name=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($env:MOAWORK_TEST_FENCE_NAME)))).Replace('-','')",
    "$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\MoaWork\\GateLeaseTest')",
    "if($null -ne $key -and $null -ne $key.GetValue($name,$null)){exit 1}else{exit 0}",
  ].join(";");
  return spawnSync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true, env: { ...process.env, MOAWORK_TEST_FENCE_NAME: fenceName },
  }).status === 1;
}

function fenceCanBeAcquired(fenceName) {
  if (process.platform !== "win32") return false;
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = [
    "$created=$false",
    "$mutex=[Threading.Mutex]::new($false,$env:MOAWORK_TEST_FENCE_NAME,[ref]$created)",
    "$owned=$false",
    "try{try{$owned=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$owned=$true};if(-not $owned){exit 1};$mutex.ReleaseMutex();exit 0}finally{$mutex.Dispose()}",
  ].join(";");
  return spawnSync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true, env: { ...process.env, MOAWORK_TEST_FENCE_NAME: fenceName },
  }).status === 0;
}

function processExists(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function seedFenceMarker(fenceName) {
  if (process.platform !== "win32") return;
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = [
    "$sha=[Security.Cryptography.SHA256]::Create()",
    "$name=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($env:MOAWORK_TEST_FENCE_NAME)))).Replace('-','')",
    "$key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\\MoaWork\\GateLeaseTest',$true)",
    "$key.SetValue($name,'{\"version\":1,\"fixture\":true}',[Microsoft.Win32.RegistryValueKind]::String)",
    "$key.Dispose()",
  ].join(";");
  const run = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true, env: { ...process.env, MOAWORK_TEST_FENCE_NAME: fenceName },
  });
  assert.equal(run.status, 0, `${run.stdout ?? ""}${run.stderr ?? ""}`);
}

function recoveryEvidence(fenceName, valueName, operation, rawValue = "") {
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = [
    "$root='Software\\MoaWork\\GateLeaseTest'",
    "$path=$root+'\\RecoveryAudit'",
    "if($env:MOAWORK_TEST_EVIDENCE_OP -eq 'write'){$key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($path,$true);$key.SetValue($env:MOAWORK_TEST_EVIDENCE_NAME,$env:MOAWORK_TEST_EVIDENCE_RAW,[Microsoft.Win32.RegistryValueKind]::String);$key.Dispose();exit 0}",
    "if($env:MOAWORK_TEST_EVIDENCE_OP -eq 'read'){$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($path,$false);if($null -eq $key){exit 2};[Console]::Out.Write([string]$key.GetValue($env:MOAWORK_TEST_EVIDENCE_NAME,''));$key.Dispose();exit 0}",
    "if($env:MOAWORK_TEST_EVIDENCE_OP -eq 'delete'){$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($path,$true);if($null -ne $key){$key.DeleteValue($env:MOAWORK_TEST_EVIDENCE_NAME,$false);$empty=@($key.GetValueNames()).Count -eq 0;$key.Dispose();if($empty){$rootKey=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($root,$true);if($null -ne $rootKey){try{$rootKey.DeleteSubKey('RecoveryAudit',$false)}catch{};$rootKey.Dispose()}}};exit 0}",
    "exit 78",
  ].join(";");
  const run = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8", windowsHide: true,
    env: { ...process.env, MOAWORK_TEST_FENCE_NAME: fenceName, MOAWORK_TEST_EVIDENCE_NAME: valueName, MOAWORK_TEST_EVIDENCE_OP: operation, MOAWORK_TEST_EVIDENCE_RAW: rawValue },
  });
  assert.equal(run.status, 0, `${run.stdout ?? ""}${run.stderr ?? ""}`);
  return run.stdout;
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

function observeHarnessChild(child, { startedAt = Date.now(), now = () => Date.now() } = {}) {
  let output = "";
  const observedAt = new Map();
  const observe = (chunk) => {
    const receivedAt = now();
    output += chunk;
    for (const kind of ["GATE_GUARDIAN_READY", "GATE_GUARDIAN_QUARANTINED"]) {
      if (!observedAt.has(kind) && output.includes(kind)) observedAt.set(kind, receivedAt);
    }
  };
  child.stdout.on("data", observe);
  child.stderr.on("data", observe);

  let processExitedAt = null;
  let terminalAt = null;
  child.once("exit", () => {
    processExitedAt = now();
  });
  const exited = new Promise((resolve) => child.once("close", (code, signal) => {
    terminalAt = now();
    resolve({ code, signal });
  }));
  return {
    exited,
    output: () => output,
    startedAt,
    observedAt: (kind) => observedAt.get(kind) ?? null,
    processExitedAt: () => processExitedAt,
    terminalAt: () => terminalAt,
  };
}

function startHarness({ broker, fenceName, expression, args = [], cwd = ROOT, ...config }) {
  const startedAt = Date.now();
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
  return { child, ...observeHarnessChild(child, { startedAt }) };
}

test("harness lifecycle waits for drained output after process exit", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let clock = 1_000;
  const harness = observeHarnessChild(child, { startedAt: clock, now: () => clock });
  let terminalSettled = false;
  harness.exited.then(() => {
    terminalSettled = true;
  });

  clock = 1_100;
  child.stdout.emit("data", Buffer.from("GATE_GUARDIAN_"));
  clock = 1_125;
  child.stdout.emit("data", Buffer.from("READY {}\n"));
  clock = 1_200;
  child.emit("exit", 78, null);
  await Promise.resolve();
  assert.equal(terminalSettled, false, "process exit must not expose output before stream close");

  clock = 1_250;
  child.stderr.emit("data", Buffer.from("GATE_GUARDIAN_QUARANTINED {}\n"));
  clock = 1_300;
  child.emit("close", 78, null);
  const result = await harness.exited;

  assert.deepEqual(result, { code: 78, signal: null });
  assert.equal(terminalSettled, true);
  assert.equal(harness.observedAt("GATE_GUARDIAN_READY"), 1_125);
  assert.equal(harness.processExitedAt(), 1_200);
  assert.equal(harness.observedAt("GATE_GUARDIAN_QUARANTINED"), 1_250);
  assert.equal(harness.terminalAt(), 1_300);
  assert.match(harness.output(), /GATE_GUARDIAN_READY/u);
  assert.match(harness.output(), /GATE_GUARDIAN_QUARANTINED/u);

  const lateChild = new EventEmitter();
  lateChild.stdout = new EventEmitter();
  lateChild.stderr = new EventEmitter();
  clock = 2_000;
  const lateHarness = observeHarnessChild(lateChild, { startedAt: clock, now: () => clock });
  clock = 2_050;
  lateChild.emit("exit", 78, null);
  clock = 2_100;
  lateChild.stderr.emit("data", Buffer.from("GATE_GUARDIAN_READY {}\n"));
  clock = 2_150;
  lateChild.stderr.emit("data", Buffer.from("GATE_GUARDIAN_QUARANTINED {}\n"));
  clock = 2_200;
  lateChild.emit("close", 78, null);
  assert.deepEqual(await lateHarness.exited, { code: 78, signal: null });
  assert.equal(lateHarness.processExitedAt(), 2_050);
  assert.equal(lateHarness.observedAt("GATE_GUARDIAN_READY"), 2_100);
  assert.equal(lateHarness.observedAt("GATE_GUARDIAN_QUARANTINED"), 2_150);
  assert.equal(lateHarness.terminalAt(), 2_200);
});

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

test("guardian broker wait honors the caller deadline before a slow heartbeat", { skip: process.platform !== "win32" }, async () => {
  const broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 5_000, idleTimeoutMs: -1 });
  const fenceName = testFence();
  const owner = await acquireGateLease({ port: broker.port, requestId: "broker-deadline-owner", label: "owner" });
  let waiting;
  try {
    waiting = startHarness({ broker, fenceName, expression: "console.log('WAITING_MUST_NOT_START')", waitTimeoutMs: 250 });
    await waitUntil(() => waiting.output().includes("GATE_GUARDIAN_READY"), 15_000);
    await waitUntil(() => broker.snapshot().queued.length === 1, 15_000);
    const startedAt = Date.now();
    const result = await waiting.exited;
    assert.equal(result.code, 78, waiting.output());
    assert.ok(Date.now() - startedAt < 2_000, waiting.output());
    assert.match(waiting.output(), /GATE_LEASE_TIMEOUT/u);
    assert.doesNotMatch(waiting.output(), /GATE_BROKER_WAIT_TIMEOUT|WAITING_MUST_NOT_START/u);
    assert.equal(markerExists(fenceName), false);
  } finally {
    owner.release();
    await stop(waiting?.child); await broker.close(); cleanupFence(fenceName);
  }
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

test("direct guardian setup failure closes its pipe, process tree, lease, and fence", { skip: process.platform !== "win32" }, async () => {
  for (const forceSetupCleanupFallback of [false, true]) {
    const broker = await createLeaseBroker({
      port: 0,
      diagnosticIntervalMs: 5,
      idleTimeoutMs: -1,
      crashRecoveryDelayMs: 200,
    });
    const fenceName = testFence();
    cleanupFence(fenceName);
    let failure;
    try {
      await assert.rejects(
        startDirectGuardian({
          broker,
          fenceName,
          controlNonce: "array",
          childExpression: "console.log('NONCE_CHILD_STARTED:' + process.pid); setInterval(() => {}, 1000)",
          injectSetupFailureAfterChildStart: true,
          forceSetupCleanupFallback,
        }).catch((error) => {
          failure = error;
          throw error;
        }),
        /DIRECT_GUARDIAN_SETUP_FAILURE_INJECTED/u,
      );
      const evidence = directGuardianSetupEvidence.get(failure);
      assert.ok(evidence, "setup failure must retain bounded cleanup evidence");
      assert.equal(evidence.closeObserved, true, evidence.cleanupError?.stack);
      assert.equal(evidence.forced, forceSetupCleanupFallback);
      assert.equal(evidence.cleanupError, null);
      const childPid = Number(/NONCE_CHILD_STARTED:(\d+)/u.exec(evidence.output)?.[1]);
      assert.ok(Number.isSafeInteger(childPid) && childPid > 0, evidence.output);
      await waitUntil(() => !processExists(evidence.guardianPid) && !processExists(childPid));
      await waitUntil(() => broker.snapshot().active === null);
      assert.deepEqual(broker.snapshot().queued, []);
      assert.equal(markerExists(fenceName), forceSetupCleanupFallback);
      if (forceSetupCleanupFallback) cleanupFence(fenceName);
      assert.equal(markerExists(fenceName), false);
      assert.equal(fenceCanBeAcquired(fenceName), true);
    } finally {
      await broker.close();
      cleanupFence(fenceName);
    }
  }
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
      let failed;
      let successor;
      try {
        failed = await startDirectGuardian({
          broker,
          fenceName,
          ...(phase === "envelope" ? { envelopeNonce: kind } : { controlNonce: kind }),
        });
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
        failed?.channel.close();
        await stop(failed?.guardian);
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

test("verified clean release clears its marker before a parallel broker can cross the fence", { skip: process.platform !== "win32" }, async () => {
  const ownerBroker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 5, idleTimeoutMs: -1 });
  const successorBroker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 5, idleTimeoutMs: -1 });
  const fenceName = testFence();
  const temp = await mkdtemp(path.join(os.tmpdir(), "moawork-gate-parallel-handoff-"));
  const releasePath = path.join(temp, "release-owner");
  cleanupFence(fenceName);
  const first = startHarness({
    broker: ownerBroker,
    fenceName,
    expression: "const fs=require('node:fs'); console.log('PARALLEL_OWNER_READY'); const hold=setInterval(()=>{if(fs.existsSync(process.argv[1]))clearInterval(hold)},25)",
    args: [releasePath],
    runTimeoutMs: 10_000,
    testFault: "verified-release-handoff-delay",
  });
  let second;
  try {
    await waitUntil(() => first.output().includes("PARALLEL_OWNER_READY"));
    second = startHarness({
      broker: successorBroker,
      fenceName,
      expression: "console.log('PARALLEL_SUCCESSOR_STARTED')",
      bootstrapTimeoutMs: 15_000,
    });
    await waitUntil(() => second.output().includes("GATE_FENCE_WAIT"), 15_000);
    await writeFile(releasePath, "release\n");
    await waitUntil(() => first.output().includes("GATE_TEST_VERIFIED_RELEASE_BARRIER"), 10_000);
    assert.match(first.output(), /GATE_TEST_VERIFIED_RELEASE_BARRIER.*"path":"normal"/u);
    assert.match(first.output(), /GATE_TEST_VERIFIED_RELEASE_BARRIER.*"markerOwned":false/u);
    assert.match(first.output(), /GATE_TEST_VERIFIED_RELEASE_BARRIER.*"fenceOwned":true/u);
    assert.doesNotMatch(second.output(), /PARALLEL_SUCCESSOR_STARTED|GATE_GUARDIAN_QUARANTINED/u);
    assert.equal((await first.exited).code, 0, first.output());
    assert.equal((await second.exited).code, 0, second.output());
    assert.match(second.output(), /PARALLEL_SUCCESSOR_STARTED/u);
    assert.match(second.output(), /GATE_LEASE_RELEASED.*"activeProcesses":0/u);
    assert.equal(markerExists(fenceName), false);
    assert.equal(ownerBroker.snapshot().active, null);
    assert.equal(successorBroker.snapshot().active, null);
  } finally {
    await stop(first.child);
    await stop(second?.child);
    await ownerBroker.close();
    await successorBroker.close();
    cleanupFence(fenceName);
    await rm(temp, { recursive: true, force: true });
  }
});

test("verified-zero generic release error clears its marker before a parallel broker can cross the fence", { skip: process.platform !== "win32" }, async () => {
  const ownerBroker = await createMalformedGuardianBroker("RELEASE_ARRAY");
  const successorBroker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 5, idleTimeoutMs: -1 });
  const fenceName = testFence();
  const temp = await mkdtemp(path.join(os.tmpdir(), "moawork-gate-generic-handoff-"));
  const releasePath = path.join(temp, "release-owner");
  cleanupFence(fenceName);
  const first = startHarness({
    broker: ownerBroker,
    fenceName,
    expression: "const fs=require('node:fs'); console.log('GENERIC_OWNER_READY'); const hold=setInterval(()=>{if(fs.existsSync(process.argv[1]))clearInterval(hold)},25)",
    args: [releasePath],
    runTimeoutMs: 10_000,
    testFault: "verified-release-handoff-delay",
  });
  let second;
  try {
    await waitUntil(() => first.output().includes("GENERIC_OWNER_READY"));
    second = startHarness({
      broker: successorBroker,
      fenceName,
      expression: "console.log('GENERIC_SUCCESSOR_STARTED')",
      bootstrapTimeoutMs: 15_000,
    });
    await waitUntil(() => second.output().includes("GATE_FENCE_WAIT"), 15_000);
    await writeFile(releasePath, "release\n");
    await waitUntil(() => first.output().includes("GATE_TEST_VERIFIED_RELEASE_BARRIER"), 10_000);
    assert.match(first.output(), /GATE_TEST_VERIFIED_RELEASE_BARRIER.*"path":"generic-error"/u);
    assert.match(first.output(), /GATE_TEST_VERIFIED_RELEASE_BARRIER.*"markerOwned":false/u);
    assert.match(first.output(), /GATE_TEST_VERIFIED_RELEASE_BARRIER.*"fenceOwned":true/u);
    assert.doesNotMatch(second.output(), /GENERIC_SUCCESSOR_STARTED|GATE_GUARDIAN_QUARANTINED/u);
    assert.equal((await first.exited).code, 78, first.output());
    assert.match(first.output(), /GATE_BROKER_RELEASE_SCHEMA/u);
    assert.doesNotMatch(first.output(), /GATE_GUARDIAN_QUARANTINED/u);
    assert.equal(ownerBroker.releaseCompleteCount, 0);
    assert.equal((await second.exited).code, 0, second.output());
    assert.match(second.output(), /GENERIC_SUCCESSOR_STARTED/u);
    assert.match(second.output(), /GATE_LEASE_RELEASED.*"activeProcesses":0/u);
    assert.equal(markerExists(fenceName), false);
    assert.equal(successorBroker.snapshot().active, null);
  } finally {
    await stop(first.child);
    await stop(second?.child);
    await ownerBroker.close();
    await successorBroker.close();
    cleanupFence(fenceName);
    await rm(temp, { recursive: true, force: true });
  }
});

test("verified command results survive release write failure while queued successors stay recovery-delayed", { skip: process.platform !== "win32" }, async () => {
  const recoveryMs = 1_000;
  const broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 5, idleTimeoutMs: -1, crashRecoveryDelayMs: recoveryMs });
  const fenceName = testFence();
  const temp = await mkdtemp(path.join(os.tmpdir(), "moawork-gate-release-degraded-"));
  const releasePath = path.join(temp, "release-owner");
  cleanupFence(fenceName);
  const first = startHarness({
    broker,
    fenceName,
    expression: "const fs=require('node:fs'); console.log('DEGRADED_OWNER_READY'); const hold=setInterval(()=>{if(fs.existsSync(process.argv[1]))clearInterval(hold)},25)",
    args: [releasePath],
    runTimeoutMs: 10_000,
    testFault: "release-write-failure",
  });
  let second;
  let nonzero;
  try {
    await waitUntil(() => first.output().includes("DEGRADED_OWNER_READY"));
    second = startHarness({ broker, fenceName, expression: "console.log('DEGRADED_SUCCESSOR_STARTED')" });
    await waitUntil(() => broker.snapshot().queued.length === 1, 10_000);
    const releasedAt = Date.now();
    await writeFile(releasePath, "release\n");

    assert.equal((await first.exited).code, 0, first.output());
    assert.match(first.output(), /GATE_LEASE_RELEASE_DEGRADED/u, first.output());
    const warnings = first.output().split(/\r?\n/u).filter((line) => line.startsWith("GATE_LEASE_RELEASE_DEGRADED:"));
    assert.deepEqual(warnings, [
      "GATE_LEASE_RELEASE_DEGRADED: gate command finished; preserving child exit code 0 after activeProcesses=0; broker recovery required (GATE_BROKER_WRITE_FAILED)",
    ]);
    assert.doesNotMatch(first.output(), /GATE_LEASE_FAILURE|GATE_LEASE_RELEASED/u);
    assert.equal(markerExists(fenceName), false);

    assert.equal((await second.exited).code, 0, second.output());
    assert.ok(Date.now() - releasedAt >= recoveryMs - 100, `successor bypassed ${recoveryMs}ms recovery`);
    assert.match(second.output(), /DEGRADED_SUCCESSOR_STARTED/u);
    assert.match(second.output(), /GATE_LEASE_RELEASED.*"activeProcesses":0/u);

    nonzero = startHarness({
      broker,
      fenceName,
      expression: "console.log('DEGRADED_NONZERO'); process.exit(37)",
      testFault: "release-write-failure",
    });
    assert.equal((await nonzero.exited).code, 37, nonzero.output());
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.match(nonzero.output(), /GATE_LEASE_RELEASE_DEGRADED/u, nonzero.output());
    assert.match(nonzero.output(), /GATE_LEASE_RELEASE_DEGRADED: gate command finished; preserving child exit code 37 after activeProcesses=0; broker recovery required \(GATE_BROKER_WRITE_FAILED\)/u);
    assert.doesNotMatch(nonzero.output(), /GATE_LEASE_FAILURE|GATE_LEASE_RELEASED/u);
    assert.equal(markerExists(fenceName), false);
    await waitUntil(() => broker.snapshot().active === null, recoveryMs + 2_000);

    for (const run of [first, nonzero]) {
      const guardianPid = Number(run.output().match(/GATE_GUARDIAN_READY[^\n]*"guardianPid":(\d+)/u)?.[1]);
      assert.ok(guardianPid > 0, run.output());
      await waitUntil(() => {
        try { process.kill(guardianPid, 0); return false; } catch { return true; }
      });
    }
  } finally {
    await stop(first.child);
    await stop(second?.child);
    await stop(nonzero?.child);
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
    assert.equal(failed.code, 0, first.output());
    assert.match(first.output(), /GATE_LEASE_RELEASE_DEGRADED: gate command finished; preserving child exit code 0 after activeProcesses=0; broker recovery required \(GATE_BROKER_(?:WRITE_FAILED|READ_FAILED|RELEASE_EOF)\)/u);
    assert.doesNotMatch(first.output(), /GATE_GUARDIAN_INTERNAL|GATE_LEASE_FAILURE/u);
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
      successor = startHarness({
        broker: successorBroker,
        fenceName,
        expression: "console.log('PROTOCOL_RECOVERED')",
        bootstrapTimeoutMs: 15_000,
      });
      assert.equal((await successor.exited).code, 0, `${fixture}: ${successor.output()}`);
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

test("broker restart handoff clears a verified marker before releasing the OS fence", { skip: process.platform !== "win32" }, async () => {
  let broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 20, idleTimeoutMs: -1 });
  const port = broker.port;
  const fenceName = testFence();
  const temp = await mkdtemp(path.join(os.tmpdir(), "moawork-gate-restart-handoff-"));
  const releasePath = path.join(temp, "release-owner");
  const first = startHarness({
    broker,
    fenceName,
    expression: "const fs=require('node:fs'); console.log('FIRST_START'); const hold=setInterval(()=>{if(fs.existsSync(process.argv[1]))clearInterval(hold)},25)",
    args: [releasePath],
    runTimeoutMs: 10_000,
    testFault: "verified-release-handoff-delay",
  });
  let second;
  try {
    await waitUntil(() => first.output().includes("FIRST_START"));
    await broker.close();
    broker = await createLeaseBroker({ port, diagnosticIntervalMs: 20, idleTimeoutMs: -1 });
    second = startHarness({ broker, fenceName, expression: "console.log('SECOND_START')", bootstrapTimeoutMs: 15_000 });
    await waitUntil(() => second.output().includes("GATE_FENCE_WAIT"), 15_000);
    await writeFile(releasePath, "release\n");
    await waitUntil(() => first.output().includes("GATE_TEST_VERIFIED_RELEASE_BARRIER"), 10_000);
    assert.match(first.output(), /GATE_TEST_VERIFIED_RELEASE_BARRIER.*"path":"degraded"/u);
    assert.match(first.output(), /GATE_TEST_VERIFIED_RELEASE_BARRIER.*"markerOwned":false/u);
    assert.match(first.output(), /GATE_TEST_VERIFIED_RELEASE_BARRIER.*"fenceOwned":true/u);
    assert.doesNotMatch(second.output(), /SECOND_START|GATE_GUARDIAN_QUARANTINED/u);
    assert.equal((await first.exited).code, 0, first.output());
    assert.match(first.output(), /GATE_LEASE_RELEASE_DEGRADED/u);
    const secondResult = await second.exited;
    assert.equal(secondResult.code, 0, second.output());
    assert.match(second.output(), /SECOND_START/u);
    assert.equal(markerExists(fenceName), false);
    assert.equal(broker.snapshot().active, null);
  } finally {
    await stop(first.child);
    await stop(second?.child);
    await broker.close();
    cleanupFence(fenceName);
    await rm(temp, { recursive: true, force: true });
  }
});

test("cleanup quarantine exits, releases the fence, and remains fail-closed until evidence cleanup", { skip: process.platform !== "win32" }, async (t) => {
  let broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 20, idleTimeoutMs: -1 });
  const port = broker.port;
  const fenceName = testFence();
  const first = startHarness({
    broker, fenceName, expression: "setInterval(() => {}, 1000)", runTimeoutMs: 100, testFault: "cleanup-hang",
  });
  let second;
  let successor;
  try {
    const firstResult = await first.exited;
    assert.equal(firstResult.code, 78, first.output());
    assert.match(first.output(), /GATE_GUARDIAN_QUARANTINED/u);
    assert.match(first.output(), /cleanup-unverified:timeout/u);
    const firstGuardian = Number(first.output().match(/GATE_GUARDIAN_READY[^\n]*"guardianPid":(\d+)/u)?.[1]);
    const firstCommand = Number(first.output().match(/GATE_LEASE_ACQUIRED[^\n]*"commandPid":(\d+)/u)?.[1]);
    assert.ok(firstGuardian > 0 && firstCommand > 0, first.output());
    await waitUntil(() => !processExists(firstGuardian) && !processExists(firstCommand));
    assert.equal(fenceCanBeAcquired(fenceName), true, "terminal quarantine retained the machine fence");
    assert.equal(markerExists(fenceName), true, "terminal quarantine consumed durable evidence");
    await waitUntil(() => broker.snapshot().active === null && broker.snapshot().queued.length === 0);
    await broker.close();
    broker = await createLeaseBroker({ port, diagnosticIntervalMs: 20, idleTimeoutMs: -1 });
    second = startHarness({ broker, fenceName, expression: "console.log('MUST_NOT_START')" });
    const secondResult = await second.exited;
    assert.equal(secondResult.code, 78, second.output());
    const secondReadyAt = second.observedAt("GATE_GUARDIAN_READY");
    const secondQuarantinedAt = second.observedAt("GATE_GUARDIAN_QUARANTINED");
    const secondProcessExitedAt = second.processExitedAt();
    const secondTerminalAt = second.terminalAt();
    assert.ok(Number.isSafeInteger(secondReadyAt) && secondReadyAt - second.startedAt < 10_000, second.output());
    assert.ok(Number.isSafeInteger(secondTerminalAt) && secondTerminalAt - secondReadyAt < 3_000, second.output());
    assert.ok(Number.isSafeInteger(secondProcessExitedAt)
      && secondProcessExitedAt >= second.startedAt && secondProcessExitedAt <= secondTerminalAt, second.output());
    assert.ok(Number.isSafeInteger(secondQuarantinedAt)
      && secondQuarantinedAt >= secondReadyAt && secondQuarantinedAt <= secondTerminalAt, second.output());
    t.diagnostic(`quarantine timing ${JSON.stringify({
      bootstrapMs: secondReadyAt - second.startedAt,
      readyToQuarantineMs: secondQuarantinedAt - secondReadyAt,
      quarantineToTerminalMs: secondTerminalAt - secondQuarantinedAt,
      processExitToTerminalMs: secondTerminalAt - secondProcessExitedAt,
    })}`);
    assert.match(second.output(), /durable-crash-marker/u);
    assert.doesNotMatch(second.output(), /MUST_NOT_START/u);
    assert.equal(fenceCanBeAcquired(fenceName), true, "marker rejection retained the machine fence");

    cleanupFence(fenceName);
    assert.equal(markerExists(fenceName), false);
    successor = startHarness({ broker, fenceName, expression: "console.log('CLEANUP_QUARANTINE_RECOVERED')", waitTimeoutMs: 12_000 });
    assert.equal((await successor.exited).code, 0, successor.output());
    assert.match(successor.output(), /CLEANUP_QUARANTINE_RECOVERED/u);
    assert.match(successor.output(), /GATE_LEASE_RELEASED.*"activeProcesses":0/u);
    assert.equal(markerExists(fenceName), false);
    assert.equal(broker.snapshot().active, null);
    assert.deepEqual(broker.snapshot().queued, []);
  } finally {
    await stop(first.child); await stop(second?.child); await stop(successor?.child); await broker.close(); cleanupFence(fenceName);
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
    const secondResult = await second.exited;
    assert.equal(secondResult.code, 78, second.output());
    assert.match(second.output(), /durable-crash-marker/u);
    assert.doesNotMatch(second.output(), /MUST_NOT_START/u);
    assert.doesNotMatch(second.output(), /release-complete|GATE_LEASE_RELEASED/u);
  } finally {
    const secondGuardian = Number(second?.output().match(/GATE_GUARDIAN_READY[^\n]*"guardianPid":(\d+)/u)?.[1]);
    if (secondGuardian > 0) { try { process.kill(secondGuardian, "SIGKILL"); } catch {} }
    await stop(first.child); await stop(second?.child); await broker.close(); cleanupFence(fenceName);
  }
});

test("startup durable marker exits promptly without consuming evidence or starting a command", { skip: process.platform !== "win32" }, async () => {
  const broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 20, idleTimeoutMs: -1 });
  const fenceName = testFence();
  let first;
  let second;
  try {
    seedFenceMarker(fenceName);
    first = startHarness({ broker, fenceName, expression: "console.log('MUST_NOT_START')" });
    const firstResult = await first.exited;
    assert.equal(firstResult.code, 78, first.output());
    assert.match(first.output(), /GATE_LEASE_FAILURE[^\n]*durable-crash-marker[^\n]*GATE_GUARDIAN_QUARANTINED/u);
    assert.doesNotMatch(first.output(), /MUST_NOT_START|release-complete|GATE_LEASE_RELEASED/u);
    assert.equal(markerExists(fenceName), true);
    second = startHarness({ broker, fenceName, expression: "console.log('STILL_MUST_NOT_START')" });
    const secondResult = await second.exited;
    assert.equal(secondResult.code, 78, second.output());
    assert.match(second.output(), /GATE_LEASE_FAILURE[^\n]*durable-crash-marker[^\n]*GATE_GUARDIAN_QUARANTINED/u);
    assert.doesNotMatch(second.output(), /STILL_MUST_NOT_START|release-complete|GATE_LEASE_RELEASED/u);
    assert.equal(markerExists(fenceName), true);
  } finally {
    await stop(first?.child); await stop(second?.child); await broker.close(); cleanupFence(fenceName);
  }
});

test("startup recovery evidence exits promptly and remains byte-exact until explicit recovery", { skip: process.platform !== "win32" }, async (t) => {
  for (const kind of ["malformed", "prepared"]) {
    await t.test(kind, async () => {
      const broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 20, idleTimeoutMs: -1 });
      const fenceName = testFence();
      const valueName = `Fixture_${randomUUID().replaceAll("-", "")}`;
      const markerName = createHash("sha256").update(fenceName).digest("hex").toUpperCase();
      const rawValue = kind === "malformed" ? "{fixture-malformed" : JSON.stringify({ fenceName, valueName: markerName, result: "prepared", fixture: true });
      let first;
      let second;
      try {
        recoveryEvidence(fenceName, valueName, "write", rawValue);
        first = startHarness({ broker, fenceName, expression: "console.log('MUST_NOT_START')" });
        await waitUntil(() => first.output().includes("GATE_GUARDIAN_READY"), 15_000);
        const rejectedAt = Date.now();
        const firstResult = await first.exited;
        assert.equal(firstResult.code, 78, first.output());
        assert.ok(Date.now() - rejectedAt < 2_000, first.output());
        assert.match(first.output(), new RegExp(kind === "malformed" ? "recovery-audit-malformed" : "recovery-incomplete", "u"));
        assert.doesNotMatch(first.output(), /MUST_NOT_START|release-complete|GATE_LEASE_RELEASED/u);
        assert.equal(recoveryEvidence(fenceName, valueName, "read"), rawValue);
        second = startHarness({ broker, fenceName, expression: "console.log('STILL_MUST_NOT_START')" });
        const secondResult = await second.exited;
        assert.equal(secondResult.code, 78, second.output());
        assert.doesNotMatch(second.output(), /STILL_MUST_NOT_START|release-complete|GATE_LEASE_RELEASED/u);
        assert.equal(recoveryEvidence(fenceName, valueName, "read"), rawValue);
      } finally {
        await stop(first?.child); await stop(second?.child); recoveryEvidence(fenceName, valueName, "delete"); await broker.close(); cleanupFence(fenceName);
      }
    });
  }
});

test("markerless abandoned fence recovers and runs one contained command", { skip: process.platform !== "win32" }, async () => {
  const broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 20, idleTimeoutMs: -1 });
  const fenceName = testFence();
  const owner = await startAbandonedFenceOwner(fenceName);
  const run = startHarness({ broker, fenceName, expression: "console.log('RECOVERED_AFTER_ABANDON')" });
  try {
    await waitUntil(() => run.output().includes("GATE_GUARDIAN_READY"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    owner.child.kill("SIGKILL");
    await owner.exited;
    const result = await run.exited;
    assert.equal(result.code, 0, run.output());
    assert.match(run.output(), /RECOVERED_AFTER_ABANDON/u);
    assert.match(run.output(), /GATE_LEASE_RELEASED.*"activeProcesses":0/u);
    assert.doesNotMatch(run.output(), /GATE_GUARDIAN_QUARANTINED/u);
    assert.equal(markerExists(fenceName), false);
  } finally {
    await stop(owner.child); await stop(run.child); await broker.close(); cleanupFence(fenceName);
  }
});

// Issue #718: between Open-SafeFence and GATE_FENCE_ACQUIRED the guardian used
// to say nothing, so an outside observer could not tell a guardian waiting for
// the broker grant from one waiting for the OS fence - #718 comment 3 read a
// guardian that had already quarantined as a stall in that gap. Both waits now
// report the same event with the stage that is actually blocking.
test("every pre-fence wait is reported with the stage that is blocking", async () => {
  const guardian = await readFile(GUARDIAN, "utf8");
  assert.match(guardian, /\$fenceOpenedAt = \[DateTimeOffset\]::UtcNow\.ToUnixTimeMilliseconds\(\)/u);
  assert.match(guardian, /GATE_FENCE_WAIT.*waitedMs = \$brokerWaitNow - \$fenceOpenedAt; reason = "broker-grant"/u);
  assert.match(guardian, /GATE_FENCE_WAIT.*waitedMs = \$fenceWaitNow - \$fenceOpenedAt; reason = "os-fence"/u);
  // the broker-grant heartbeat repeats on a 30s cadence, the OS fence wait on 1s
  assert.match(guardian, /\$brokerWaitNow - \$fenceOpenedAt -ge 30000 -and \(\$lastFenceWaitDiagnostic -eq 0L -or \$brokerWaitNow - \$lastFenceWaitDiagnostic -ge 30000\)/u);
});

test("live machine fence owner times out before command and queued successor recovers", { skip: process.platform !== "win32" }, async () => {
  const recoveryMs = 300;
  const broker = await createLeaseBroker({ port: 0, diagnosticIntervalMs: 20, idleTimeoutMs: -1, crashRecoveryDelayMs: recoveryMs });
  const fenceName = testFence();
  const owner = await startLiveFenceOwner(fenceName);
  const blocked = startHarness({ broker, fenceName, expression: "console.log('BLOCKED_MUST_NOT_START')", waitTimeoutMs: 350 });
  let successor;
  try {
    await waitUntil(() => blocked.output().includes("GATE_GUARDIAN_READY"));
    successor = startHarness({ broker, fenceName, expression: "console.log('SUCCESSOR_AFTER_FENCE')", waitTimeoutMs: 12_000 });
    const blockedResult = await blocked.exited;
    assert.equal(blockedResult.code, 78, blocked.output());
    assert.match(blocked.output(), /GATE_MACHINE_FENCE_TIMEOUT/u);
    assert.match(blocked.output(), /GATE_FENCE_WAIT.*"productChild":0/u);
    assert.match(blocked.output(), /GATE_FENCE_WAIT.*"reason":"os-fence"/u);
    assert.doesNotMatch(blocked.output(), /BLOCKED_MUST_NOT_START/u);
    assert.equal(markerExists(fenceName), false);
    assert.equal(owner.child.exitCode, null);
    await owner.exited;
    const successorResult = await successor.exited;
    assert.equal(successorResult.code, 0, successor.output());
    assert.match(successor.output(), /SUCCESSOR_AFTER_FENCE/u);
    assert.match(successor.output(), /GATE_LEASE_RELEASED.*"activeProcesses":0/u);
    assert.deepEqual(broker.snapshot().queued, []);
    assert.equal(broker.snapshot().active, null);
    assert.equal(markerExists(fenceName), false);
  } finally {
    await stop(owner.child); await stop(blocked.child); await stop(successor?.child); await broker.close(); cleanupFence(fenceName);
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

test("WSL full-gate entry fails closed before any product command", { skip: !WSL_AVAILABLE }, () => {
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

test("production CLI starts zero detached WSL descendants", { skip: !WSL_AVAILABLE }, () => {
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

test("native WSL Linux Node fails closed or is explicitly unavailable", { skip: !WSL_AVAILABLE }, (t) => {
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
  assert.doesNotMatch(guardian, /while \(\$true\) \{ Start-Sleep -Seconds 60 \}/u);
  assert.doesNotMatch(guardian, /controlPath|taskkill/iu);
  assert.match(guardian, /Math\]::Min\(90000L, \[Math\]::Max\(1L, \$waitDeadline - \$brokerWaitNow\)\)/u);
  assert.match(guardian, /Read-BrokerMessage \$reader \$brokerReadTimeout "WAIT"/u);
  assert.match(guardian, /if \(\$brokerWaitNow -ge \$waitDeadline\) \{ throw "GATE_LEASE_TIMEOUT" \}/u);
  assert.match(guardian, /Remove-FenceMarker \(\[string\]\$payload\.fenceName\); \$markerOwned = \$false[\s\S]*?\$fence\.ReleaseMutex\(\); \$fenceOwned = \$false/u);
  assert.match(guardian, /\$markerOwned -and \$jobZeroVerified -and -not \$quarantineReason -and \$fenceOwned[\s\S]*?Remove-FenceMarker[\s\S]*?if \(\$fenceOwned\)/u);
  assert.doesNotMatch(guardian, /-not \$fenceOwned[\s\S]{0,200}?Remove-FenceMarker/u);
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
