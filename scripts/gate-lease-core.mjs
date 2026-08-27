import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const GATE_LEASE_PROTOCOL = "moawork-full-gate-v1";
export const DEFAULT_GATE_LEASE_HOST = "127.0.0.1";
export const DEFAULT_GATE_LEASE_PORT = 48761;
export const DEFAULT_WAIT_TIMEOUT_MS = 20 * 60 * 1000;
export const DEFAULT_DIAGNOSTIC_INTERVAL_MS = 30 * 1000;

export class GateLeaseError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "GateLeaseError";
    this.code = code;
    this.detail = detail;
  }
}

function writeMessage(socket, message) {
  if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
}

function readMessages(socket, onMessage) {
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
      try {
        onMessage(JSON.parse(line));
      } catch {
        writeMessage(socket, { type: "error", code: "INVALID_MESSAGE" });
        socket.end();
      }
    }
  });
}

function safeOwner(request, acquiredAt, now = Date.now()) {
  return request
    ? {
        requestId: request.requestId,
        pid: request.pid,
        label: request.label,
        elapsedMs: acquiredAt ? Math.max(0, now - acquiredAt) : 0,
      }
    : null;
}

export async function createLeaseBroker({
  host = DEFAULT_GATE_LEASE_HOST,
  port = DEFAULT_GATE_LEASE_PORT,
  diagnosticIntervalMs = DEFAULT_DIAGNOSTIC_INTERVAL_MS,
  idleTimeoutMs = 10_000,
  crashRecoveryDelayMs = 1_000,
} = {}) {
  const clients = new Set();
  const requestIds = new Set();
  const queue = [];
  let active = null;
  let closed = false;
  let idleTimer = null;
  let recoveryTimer = null;
  let recoveryUntil = 0;

  function cancelIdleExit() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  }

  function scheduleIdleExit() {
    cancelIdleExit();
    if (!active && queue.length === 0 && clients.size === 0 && idleTimeoutMs >= 0) {
      idleTimer = setTimeout(() => void close(), idleTimeoutMs);
      idleTimer.unref?.();
    }
  }

  function grantNext() {
    if (active) return;
    const recoveryRemaining = recoveryUntil - Date.now();
    if (recoveryRemaining > 0) {
      if (!recoveryTimer) {
        recoveryTimer = setTimeout(() => {
          recoveryTimer = null;
          recoveryUntil = 0;
          grantNext();
        }, recoveryRemaining);
      }
      return;
    }
    while (queue.length > 0) {
      const candidate = queue.shift();
      if (!candidate || candidate.socket.destroyed) continue;
      candidate.state = "active";
      candidate.acquiredAt = Date.now();
      candidate.leaseToken = randomUUID();
      active = candidate;
      writeMessage(candidate.socket, {
        type: "granted",
        requestId: candidate.request.requestId,
        acquiredAt: candidate.acquiredAt,
        leaseToken: candidate.leaseToken,
      });
      break;
    }
    scheduleIdleExit();
  }

  function removeClient(client) {
    clients.delete(client);
    if (client.request?.requestId) requestIds.delete(client.request.requestId);
    const queuedAt = queue.indexOf(client);
    if (queuedAt >= 0) queue.splice(queuedAt, 1);
    if (active === client) {
      active = null;
      if (client.cleanRelease) {
        grantNext();
      } else {
        recoveryUntil = Date.now() + crashRecoveryDelayMs;
        grantNext();
      }
    }
    scheduleIdleExit();
  }

  const server = net.createServer((socket) => {
    cancelIdleExit();
    socket.setNoDelay(true);
    const client = { socket, state: "connected", request: null, acquiredAt: null };
    clients.add(client);
    writeMessage(socket, { type: "hello", protocol: GATE_LEASE_PROTOCOL });

    readMessages(socket, (message) => {
      if (message.type === "acquire") {
        const request = message.request;
        if (
          client.state !== "connected" ||
          !request ||
          typeof request.requestId !== "string" ||
          typeof request.pid !== "number" ||
          typeof request.label !== "string"
        ) {
          writeMessage(socket, { type: "error", code: "INVALID_ACQUIRE" });
          socket.end();
          return;
        }
        if (requestIds.has(request.requestId)) {
          writeMessage(socket, { type: "error", code: "DUPLICATE_REQUEST" });
          socket.end();
          return;
        }
        requestIds.add(request.requestId);
        client.request = {
          requestId: request.requestId.slice(0, 80),
          pid: request.pid,
          label: request.label.slice(0, 80),
        };
        client.state = "queued";
        queue.push(client);
        grantNext();
        return;
      }

      if (message.type === "verify" && client.state === "connected") {
        writeMessage(socket, {
          type: "verified",
          valid: typeof message.leaseToken === "string" && active?.leaseToken === message.leaseToken,
        });
        socket.end();
        return;
      }

      if (message.type === "release" && active === client) {
        client.cleanRelease = true;
        writeMessage(socket, { type: "released", requestId: client.request.requestId });
        socket.end();
        return;
      }

      writeMessage(socket, { type: "error", code: "INVALID_STATE" });
      socket.end();
    });

    socket.once("close", () => removeClient(client));
    socket.once("error", () => socket.destroy());
  });

  const diagnosticTimer = setInterval(() => {
    const now = Date.now();
    const owner = safeOwner(active?.request, active?.acquiredAt, now);
    queue.forEach((client, index) => {
      writeMessage(client.socket, {
        type: "waiting",
        requestId: client.request.requestId,
        position: index + 1,
        owner,
        waitedMs: Math.max(0, now - (client.requestedAt ?? now)),
      });
    });
  }, diagnosticIntervalMs);
  diagnosticTimer.unref?.();

  server.on("connection", (socket) => {
    const client = [...clients].find((candidate) => candidate.socket === socket);
    if (client) client.requestedAt = Date.now();
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  async function close() {
    if (closed) return;
    closed = true;
    cancelIdleExit();
    clearInterval(diagnosticTimer);
    if (recoveryTimer) clearTimeout(recoveryTimer);
    for (const client of clients) client.socket.destroy();
    await new Promise((resolve) => server.close(() => resolve()));
  }

  scheduleIdleExit();
  return {
    host,
    port: actualPort,
    close,
    snapshot() {
      return {
        active: safeOwner(active?.request, active?.acquiredAt),
        queued: queue.map((client) => client.request?.requestId),
      };
    },
  };
}

export async function probeLeaseBroker({
  host = DEFAULT_GATE_LEASE_HOST,
  port = DEFAULT_GATE_LEASE_PORT,
  timeoutMs = 750,
} = {}) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ available: false, conflict: true, reason: "handshake-timeout" }),
      timeoutMs,
    );
    readMessages(socket, (message) => {
      if (message.type === "hello" && message.protocol === GATE_LEASE_PROTOCOL) {
        finish({ available: true, conflict: false });
      } else {
        finish({ available: false, conflict: true, reason: "protocol-mismatch" });
      }
    });
    socket.once("error", (error) => {
      const retryable = error.code === "ECONNREFUSED" || error.code === "ENOENT";
      finish({ available: false, conflict: !retryable, reason: error.code ?? error.message });
    });
  });
}

export async function ensureLeaseBroker({
  host = DEFAULT_GATE_LEASE_HOST,
  port = DEFAULT_GATE_LEASE_PORT,
  startupTimeoutMs = 5_000,
  brokerPath = fileURLToPath(new URL("./gate-lease-broker.mjs", import.meta.url)),
  env = process.env,
} = {}) {
  const initial = await probeLeaseBroker({ host, port });
  if (initial.available) return;
  if (initial.conflict) {
    throw new GateLeaseError("GATE_LEASE_ENDPOINT_CONFLICT", "gate lease endpoint is owned by another service", {
      host,
      port,
      reason: initial.reason,
    });
  }

  const broker = spawn(process.execPath, [brokerPath], {
    cwd: path.dirname(brokerPath),
    detached: true,
    env: {
      ...env,
      MOAWORK_GATE_LEASE_HOST: host,
      MOAWORK_GATE_LEASE_PORT: String(port),
    },
    stdio: "ignore",
    windowsHide: true,
  });
  broker.unref();

  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const probe = await probeLeaseBroker({ host, port });
    if (probe.available) return;
    if (probe.conflict) {
      throw new GateLeaseError("GATE_LEASE_ENDPOINT_CONFLICT", "gate lease endpoint handshake failed", {
        host,
        port,
        reason: probe.reason,
      });
    }
  }
  throw new GateLeaseError("GATE_LEASE_BROKER_START_TIMEOUT", "gate lease broker did not become ready", {
    host,
    port,
    startupTimeoutMs,
  });
}

export async function acquireGateLease({
  host = DEFAULT_GATE_LEASE_HOST,
  port = DEFAULT_GATE_LEASE_PORT,
  requestId = randomUUID(),
  pid = process.pid,
  label = path.basename(process.cwd()),
  waitTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  handshakeTimeoutMs = 1_000,
  onWaiting = () => {},
} = {}) {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let acquired = false;
    let released = false;
    let settled = false;
    let resolveLost;
    const lost = new Promise((resolveLostPromise) => {
      resolveLost = resolveLostPromise;
    });

    const finishError = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(handshakeTimer);
      clearTimeout(waitTimer);
      socket.destroy();
      reject(error);
    };

    const handshakeTimer = setTimeout(
      () => finishError(new GateLeaseError("GATE_LEASE_HANDSHAKE_TIMEOUT", "gate lease handshake timed out")),
      handshakeTimeoutMs,
    );
    const waitTimer = setTimeout(
      () =>
        finishError(
          new GateLeaseError("GATE_LEASE_TIMEOUT", "timed out waiting for the heavyweight gate", {
            waitTimeoutMs,
          }),
        ),
      waitTimeoutMs,
    );

    readMessages(socket, (message) => {
      if (message.type === "hello") {
        if (message.protocol !== GATE_LEASE_PROTOCOL) {
          finishError(new GateLeaseError("GATE_LEASE_ENDPOINT_CONFLICT", "gate lease protocol mismatch"));
          return;
        }
        clearTimeout(handshakeTimer);
        writeMessage(socket, { type: "acquire", request: { requestId, pid, label } });
        return;
      }
      if (message.type === "waiting" && message.requestId === requestId) {
        onWaiting(message);
        return;
      }
      if (message.type === "granted" && message.requestId === requestId) {
        acquired = true;
        settled = true;
        clearTimeout(waitTimer);
        resolve({
          requestId,
          acquiredAt: message.acquiredAt,
          leaseToken: message.leaseToken,
          lost,
          release() {
            if (released) return;
            released = true;
            writeMessage(socket, { type: "release", requestId });
          },
        });
        return;
      }
      if (message.type === "released" && message.requestId === requestId) {
        released = true;
        socket.end();
        return;
      }
      if (message.type === "error") {
        finishError(new GateLeaseError(message.code ?? "GATE_LEASE_BROKER_ERROR", "gate lease broker rejected request"));
      }
    });

    socket.once("error", (error) => {
      if (!acquired) {
        finishError(new GateLeaseError("GATE_LEASE_CONNECTION_FAILED", error.message, { socketCode: error.code }));
      }
    });
    socket.once("close", () => {
      clearTimeout(handshakeTimer);
      clearTimeout(waitTimer);
      if (!acquired) {
        finishError(new GateLeaseError("GATE_LEASE_CONNECTION_CLOSED", "gate lease connection closed before grant"));
      } else {
        resolveLost(
          released
            ? null
            : new GateLeaseError("GATE_LEASE_LOST", "gate lease broker connection closed while gate was running"),
        );
      }
    });
  });
}

export async function verifyGateLease({
  host = DEFAULT_GATE_LEASE_HOST,
  port = DEFAULT_GATE_LEASE_PORT,
  leaseToken,
  timeoutMs = 1_000,
} = {}) {
  if (!leaseToken) return false;
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (valid) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(valid);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    readMessages(socket, (message) => {
      if (message.type === "hello" && message.protocol === GATE_LEASE_PROTOCOL) {
        writeMessage(socket, { type: "verify", leaseToken });
      } else if (message.type === "verified") {
        finish(message.valid === true);
      } else if (message.type === "error") {
        finish(false);
      }
    });
    socket.once("error", () => finish(false));
    socket.once("close", () => finish(false));
  });
}
