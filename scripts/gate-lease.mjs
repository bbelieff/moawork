#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  acquireGateLease,
  DEFAULT_GATE_LEASE_HOST,
  DEFAULT_GATE_LEASE_PORT,
  DEFAULT_WAIT_TIMEOUT_MS,
  ensureLeaseBroker,
  GateLeaseError,
  verifyGateLease,
} from "./gate-lease-core.mjs";

const args = process.argv.slice(2);
const verifyHeld = args.includes("--verify-held");
const separator = args.indexOf("--");
const command = separator >= 0 ? args[separator + 1] : undefined;
const commandArgs = separator >= 0 ? args.slice(separator + 2) : [];

const host = process.env.MOAWORK_GATE_LEASE_HOST || DEFAULT_GATE_LEASE_HOST;
const port = Number(process.env.MOAWORK_GATE_LEASE_PORT || DEFAULT_GATE_LEASE_PORT);

if (verifyHeld) {
  const valid = await verifyGateLease({
    host,
    port,
    leaseToken: process.env.MOAWORK_GATE_LEASE_TOKEN,
  });
  if (!valid) console.error('GATE_LEASE_FAILURE {"code":"GATE_LEASE_TOKEN_INVALID"}');
  process.exit(valid ? 0 : 79);
}

if (!command) {
  console.error('Usage: node scripts/gate-lease.mjs -- <command> [args...]');
  process.exit(64);
}

const waitTimeoutMs = Number(process.env.MOAWORK_GATE_WAIT_TIMEOUT_MS || DEFAULT_WAIT_TIMEOUT_MS);
const runTimeoutMs = Number(process.env.MOAWORK_GATE_RUN_TIMEOUT_MS || 30 * 60 * 1000);
const ownerLabel = (process.env.GITHUB_RUN_ID
  ? `github-${process.env.GITHUB_RUN_ID}`
  : path.basename(process.cwd())
).slice(0, 80);

function childEnvironment(leaseToken) {
  const wslEntries = new Set(
    (process.env.WSLENV ?? "")
      .split(":")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  for (const entry of [
    "MOAWORK_GATE_LEASE_TOKEN/u",
    "MOAWORK_GATE_LEASE_HOST/u",
    "MOAWORK_GATE_LEASE_PORT/u",
  ]) {
    wslEntries.add(entry);
  }
  return {
    ...process.env,
    MOAWORK_GATE_LEASE_TOKEN: leaseToken,
    MOAWORK_GATE_LEASE_HOST: host,
    MOAWORK_GATE_LEASE_PORT: String(port),
    WSLENV: [...wslEntries].join(":"),
  };
}

function structured(kind, detail) {
  console.error(`${kind} ${JSON.stringify(detail)}`);
}

async function terminateProcessTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

function exitCodeFor(error) {
  if (error?.code === "GATE_LEASE_TIMEOUT") return 75;
  if (error?.code === "GATE_LEASE_ENDPOINT_CONFLICT") return 76;
  if (error?.code === "GATE_LEASE_LOST") return 77;
  return 78;
}

let lease;
let child;
let watchdog;
let stopping = false;
const watchdogPath = fileURLToPath(new URL("./gate-lease-watch.mjs", import.meta.url));

async function acquireWithRecovery() {
  const deadline = Date.now() + waitTimeoutMs;
  let recoveryCount = 0;
  for (;;) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new GateLeaseError("GATE_LEASE_TIMEOUT", "timed out waiting for the heavyweight gate", {
        waitTimeoutMs,
        recoveryCount,
      });
    }
    try {
      await ensureLeaseBroker({ host, port });
      return await acquireGateLease({
        host,
        port,
        pid: process.pid,
        label: ownerLabel,
        waitTimeoutMs: remainingMs,
        onWaiting(message) {
          structured("GATE_LEASE_WAIT", {
            position: message.position,
            waitedMs: waitTimeoutMs - remainingMs + message.waitedMs,
            ownerPid: message.owner?.pid ?? null,
            ownerLabel: message.owner?.label ?? null,
            ownerElapsedMs: message.owner?.elapsedMs ?? null,
          });
        },
      });
    } catch (error) {
      const retryable = new Set([
        "GATE_LEASE_CONNECTION_FAILED",
        "GATE_LEASE_CONNECTION_CLOSED",
        "GATE_LEASE_HANDSHAKE_TIMEOUT",
        "GATE_LEASE_BROKER_START_TIMEOUT",
      ]);
      if (!(error instanceof GateLeaseError) || !retryable.has(error.code)) throw error;
      recoveryCount += 1;
      structured("GATE_LEASE_RECOVERY", {
        code: error.code,
        recoveryCount,
        remainingMs,
      });
      // If the broker itself died, every former owner first tears down its command tree.
      // Wait longer than that bounded teardown before electing a replacement broker.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

async function stopForSignal(signal) {
  if (stopping) return;
  stopping = true;
  await terminateProcessTree(child);
  lease?.release();
  structured("GATE_LEASE_INTERRUPTED", { signal, ownerPid: process.pid });
  process.exit(signal === "SIGINT" ? 130 : 143);
}

process.on("SIGINT", () => void stopForSignal("SIGINT"));
process.on("SIGTERM", () => void stopForSignal("SIGTERM"));

try {
  lease = await acquireWithRecovery();
  structured("GATE_LEASE_ACQUIRED", {
    ownerPid: process.pid,
    ownerLabel,
    acquiredAt: lease.acquiredAt,
    command: path.basename(command),
  });

  child = spawn(command, commandArgs, {
    cwd: process.cwd(),
    detached: process.platform !== "win32",
    env: childEnvironment(lease.leaseToken),
    stdio: "inherit",
    windowsHide: true,
  });
  watchdog = spawn(process.execPath, [watchdogPath, String(child.pid)], {
    detached: true,
    stdio: ["pipe", "ignore", "ignore"],
    windowsHide: true,
  });
  watchdog.unref();

  const childResult = new Promise((resolve) => {
    child.once("error", (error) => resolve({ kind: "spawn-error", error }));
    child.once("exit", (code, signal) => resolve({ kind: "exit", code, signal }));
  });
  const runTimeout = new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ kind: "run-timeout" }), runTimeoutMs);
    timer.unref?.();
  });
  const leaseLost = lease.lost.then((error) => ({ kind: "lease-lost", error }));
  const watchdogStopped = new Promise((resolve) => {
    watchdog.once("error", (error) => resolve({ kind: "watchdog-lost", error }));
    watchdog.once("exit", (code, signal) => resolve({ kind: "watchdog-lost", code, signal }));
  });
  const result = await Promise.race([childResult, runTimeout, leaseLost, watchdogStopped]);
  watchdog.stdin?.end();

  async function waitForWatchdogCleanup() {
    await Promise.race([
      watchdogStopped,
      new Promise((resolve) => {
        const timer = setTimeout(resolve, 1_000);
        timer.unref?.();
      }),
    ]);
  }

  if (result.kind === "run-timeout") {
    await terminateProcessTree(child);
    await waitForWatchdogCleanup();
    structured("GATE_LEASE_FAILURE", {
      code: "GATE_LEASE_RUN_TIMEOUT",
      runTimeoutMs,
      ownerPid: process.pid,
    });
    lease.release();
    process.exit(124);
  }
  if (result.kind === "lease-lost" && result.error) {
    await terminateProcessTree(child);
    await waitForWatchdogCleanup();
    structured("GATE_LEASE_FAILURE", { code: result.error.code, ownerPid: process.pid });
    process.exit(exitCodeFor(result.error));
  }
  if (result.kind === "spawn-error") {
    await waitForWatchdogCleanup();
    structured("GATE_LEASE_FAILURE", { code: "GATE_COMMAND_SPAWN_FAILED", message: result.error.message });
    lease.release();
    process.exit(78);
  }
  if (result.kind === "watchdog-lost") {
    await terminateProcessTree(child);
    structured("GATE_LEASE_FAILURE", {
      code: "GATE_LEASE_WATCHDOG_LOST",
      childExitCode: result.code ?? null,
      childSignal: result.signal ?? null,
    });
    lease.release();
    process.exit(78);
  }

  await waitForWatchdogCleanup();
  lease.release();
  structured("GATE_LEASE_RELEASED", {
    ownerPid: process.pid,
    childExitCode: result.code,
    childSignal: result.signal,
  });
  process.exit(result.code ?? (result.signal ? 1 : 0));
} catch (error) {
  const safeError = error instanceof GateLeaseError ? error : new GateLeaseError("GATE_LEASE_INTERNAL", String(error));
  structured("GATE_LEASE_FAILURE", { code: safeError.code, message: safeError.message, detail: safeError.detail });
  process.exit(exitCodeFor(safeError));
}
