import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_GATE_LEASE_HOST,
  DEFAULT_GATE_LEASE_PORT,
  DEFAULT_WAIT_TIMEOUT_MS,
  ensureLeaseBroker,
  GateLeaseError,
} from "./gate-lease-core.mjs";

export const GLOBAL_GATE_FENCE = "Global\\MoaWork.FullGate.v1";
export const DEFAULT_RUN_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 8_000;
const GUARDIAN_PROTOCOL = "moawork-gate-guardian-v2";
const guardianPath = fileURLToPath(new URL("./gate-lease-guardian.ps1", import.meta.url));

function structured(kind, detail) {
  try { process.stderr.write(`${kind} ${JSON.stringify(detail)}\n`); } catch {}
}

export function resolveGateCommand(value, env = process.env) {
  if (!value) throw new GateLeaseError("GATE_COMMAND_MISSING", "gate command is required");
  const rejectScript = (candidate) => {
    if (/\.(?:bat|cmd)$/iu.test(candidate)) {
      throw new GateLeaseError("GATE_COMMAND_SHELL_SCRIPT_REJECTED", ".bat/.cmd gate commands are not accepted");
    }
    return candidate;
  };
  rejectScript(value);
  if (path.isAbsolute(value)) return rejectScript(value);
  const extensions = path.extname(value) ? [""] : (env.PATHEXT || ".COM;.EXE").split(";");
  for (const directory of (env.PATH || "").split(path.delimiter)) {
    for (const extension of extensions) {
      const candidate = path.join(directory.replace(/^"|"$/gu, ""), `${value}${extension}`);
      if (existsSync(candidate)) return rejectScript(candidate);
    }
  }
  throw new GateLeaseError("GATE_COMMAND_NOT_FOUND", "gate command was not found on PATH", { command: value });
}

function createLineChannel(socket) {
  const messages = [];
  const waiters = [];
  let buffer = "";
  let closedError = null;
  const deliver = (message) => {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(message);
    else messages.push(message);
  };
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      try { deliver(JSON.parse(line)); }
      catch { socket.destroy(new GateLeaseError("GATE_GUARDIAN_MALFORMED", "guardian emitted malformed IPC")); }
    }
  });
  const close = (error) => {
    if (closedError) return;
    closedError = error instanceof Error ? error : new GateLeaseError("GATE_GUARDIAN_EOF", "guardian IPC closed");
    while (waiters.length) waiters.shift().reject(closedError);
  };
  socket.once("error", close);
  socket.once("close", () => close());
  return {
    send(message) {
      if (closedError || socket.destroyed) throw closedError ?? new GateLeaseError("GATE_GUARDIAN_EOF", "guardian IPC closed");
      socket.write(`${JSON.stringify(message)}\n`);
    },
    next(timeoutMs, code = "GATE_GUARDIAN_BOOTSTRAP_TIMEOUT") {
      if (messages.length) return Promise.resolve(messages.shift());
      if (closedError) return Promise.reject(closedError);
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject };
        waiters.push(waiter);
        const timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new GateLeaseError(code, "guardian IPC deadline expired", { timeoutMs }));
        }, timeoutMs);
        timer.unref?.();
        waiter.resolve = (value) => { clearTimeout(timer); resolve(value); };
        waiter.reject = (error) => { clearTimeout(timer); reject(error); };
      });
    },
    close() { socket.destroy(); },
  };
}

async function connectPipe(pipePath, deadline) {
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = net.createConnection(pipePath);
        socket.once("connect", () => resolve(socket));
        socket.once("error", reject);
      });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new GateLeaseError("GATE_GUARDIAN_BOOTSTRAP_TIMEOUT", "guardian named pipe was not ready", {
    reason: lastError?.code ?? lastError?.message,
  });
}

export async function runGateCommand({
  command,
  args = [],
  cwd = process.cwd(),
  host = DEFAULT_GATE_LEASE_HOST,
  port = DEFAULT_GATE_LEASE_PORT,
  fenceName = GLOBAL_GATE_FENCE,
  waitTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  runTimeoutMs = DEFAULT_RUN_TIMEOUT_MS,
  bootstrapTimeoutMs = DEFAULT_BOOTSTRAP_TIMEOUT_MS,
  ensureBroker = true,
  ownerLabel = path.basename(cwd),
  testFault,
  wrapperPid = process.pid,
  testSignalAfterMs,
  testSignal = "SIGTERM",
  testGuardianMode,
} = {}) {
  if (process.platform !== "win32") {
    throw new GateLeaseError(
      "GATE_POSIX_CONTAINMENT_UNAVAILABLE",
      "standard full gates require the Windows host guardian; PID/PGID-only containment is forbidden",
    );
  }
  const resolvedCommand = resolveGateCommand(command);
  if (ensureBroker) await ensureLeaseBroker();
  const nonce = randomUUID();
  const pipeName = `moawork-gate-${randomUUID()}`;
  const pipePath = `\\\\.\\pipe\\${pipeName}`;
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  const powershell = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  let guardianCommand = powershell;
  let guardianArgs = [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", guardianPath,
      "-PipeName", pipeName,
      "-PipeNonce", nonce,
      "-BootstrapWrapperPid", String(wrapperPid),
  ];
  if (testGuardianMode === "never-connect") {
    guardianCommand = process.execPath;
    guardianArgs = ["-e", "setInterval(() => {}, 1000)"];
  } else if (testGuardianMode === "stall-add-type") {
    guardianArgs = ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Seconds 60"];
  } else if (testGuardianMode === "spawn-error") {
    guardianCommand = path.join(cwd, `missing-gate-guardian-${randomUUID()}.exe`);
    guardianArgs = [];
  }
  const guardian = spawn(
    guardianCommand,
    guardianArgs,
    { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  guardian.stdout.on("data", (chunk) => { try { process.stdout.write(chunk); } catch {} });
  guardian.stderr.on("data", (chunk) => { try { process.stderr.write(chunk); } catch {} });
  guardian.stdout.on("error", () => {});
  guardian.stderr.on("error", () => {});
  const guardianTerminal = new Promise((resolve) => {
    let terminal = false;
    const settle = (result) => {
      if (terminal) return;
      terminal = true;
      resolve(result);
    };
    guardian.once("error", (error) => settle({ type: "error", error }));
    guardian.once("exit", (code, signal) => settle({ type: "exit", code, signal }));
  });
  const terminalFailure = (result, phase) => {
    const error = result.type === "error"
      ? new GateLeaseError("GATE_GUARDIAN_SPAWN_FAILED", "guardian process could not be spawned", {
          phase,
          code: result.error?.code,
          errno: result.error?.errno,
          syscall: result.error?.syscall,
          path: result.error?.path,
        })
      : new GateLeaseError("GATE_GUARDIAN_EXIT_BEFORE_READY", "guardian exited before READY", {
          phase,
          code: result.code,
          signal: result.signal,
        });
    structured("GATE_GUARDIAN_FAILURE", { code: error.code, message: error.message, detail: error.detail });
    throw error;
  };
  let bootstrapComplete = false;
  const guardianBootstrapFailure = guardianTerminal.then((result) => {
    if (bootstrapComplete) return new Promise(() => {});
    return terminalFailure(result, "bootstrap");
  });
  const deadline = Date.now() + bootstrapTimeoutMs;
  let channel;
  try {
    const socket = await Promise.race([
      connectPipe(pipePath, deadline),
      guardianBootstrapFailure,
    ]);
    channel = createLineChannel(socket);
    channel.send({
      type: "payload",
      nonce,
      payload: {
        protocol: GUARDIAN_PROTOCOL,
        host,
        port,
        fenceName,
        requestId: randomUUID(),
        label: ownerLabel.slice(0, 80),
        command: resolvedCommand,
        args,
        cwd,
        waitTimeoutMs,
        runTimeoutMs,
        wrapperPid,
        ...(testFault ? { testFault } : {}),
      },
    });
    const ready = await Promise.race([
      channel.next(Math.max(1, deadline - Date.now())),
      guardianBootstrapFailure,
    ]);
    if (ready?.type !== "ready" || ready?.nonce !== nonce || ready?.wrapperPid !== wrapperPid) {
      throw new GateLeaseError("GATE_GUARDIAN_READY_INVALID", "guardian READY failed identity validation");
    }
    bootstrapComplete = true;
    structured("GATE_GUARDIAN_READY", {
      guardianPid: ready.guardianPid,
      wrapperCreationIdentity: ready.wrapperCreationIdentity,
      fenceName: ready.fenceName,
      bootIdentity: ready.bootIdentity,
    });
  } catch (error) {
    bootstrapComplete = true;
    guardian.kill();
    await guardianTerminal;
    channel?.close();
    throw error;
  }

  let signaled = false;
  const forward = (signal) => {
    if (signaled) return;
    signaled = true;
    try { channel.send({ type: "signal", nonce, signal }); } catch {}
  };
  const onSigint = () => forward("SIGINT");
  const onSigterm = () => forward("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  const testSignalTimer = testSignalAfterMs
    ? setTimeout(() => forward(testSignal === "SIGINT" ? "SIGINT" : "SIGTERM"), testSignalAfterMs)
    : null;
  try {
    const result = await guardianTerminal;
    if (result.type === "error") terminalFailure(result, "running");
    if (result.signal) throw new GateLeaseError("GATE_GUARDIAN_SIGNALLED", "guardian terminated unexpectedly", result);
    return result.code ?? 78;
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    if (testSignalTimer) clearTimeout(testSignalTimer);
    channel.close();
  }
}
