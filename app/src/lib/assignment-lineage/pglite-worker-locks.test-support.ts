import type { Worker as NodeWorker } from "node:worker_threads";

const protocol = "moawork:pglite-test-web-lock";

type LockCallback<T> = (lock: { name: string; mode: "exclusive" }) => T | PromiseLike<T>;

type LockRequest = {
  protocol: typeof protocol;
  type: "request";
  requestId: string;
  name: string;
};

type LockRelease = {
  protocol: typeof protocol;
  type: "release";
  requestId: string;
};

type LockMessage = LockRequest | LockRelease;

type LockManagerSubset = {
  request<T>(name: string, callback: LockCallback<T>): Promise<T>;
};

type LockState = {
  held: boolean;
  queue: Array<() => void>;
};

function isLockMessage(value: unknown): value is LockMessage {
  return typeof value === "object" && value !== null && "protocol" in value
    && value.protocol === protocol;
}

/**
 * PGliteWorker requires Web Locks in both its client and worker contexts.
 * Node 24 exposes them, while the Node 22 CI runtime exposes navigator without
 * navigator.locks. This broker supplies the same exclusive lock queue to the
 * Vitest process and every worker_threads worker used by this test.
 */
export class PGliteWorkerLockBroker {
  workerRequestCount = 0;

  readonly lockManager: LockManagerSubset = {
    request: async <T>(name: string, callback: LockCallback<T>) => {
      await this.acquire(name);
      try {
        return await callback({ name, mode: "exclusive" });
      } finally {
        this.release(name);
      }
    },
  };

  private readonly locks = new Map<string, LockState>();

  private acquire(name: string) {
    const state = this.locks.get(name) ?? { held: false, queue: [] };
    this.locks.set(name, state);
    return new Promise<void>((resolve) => {
      state.queue.push(resolve);
      this.pump(state);
    });
  }

  private release(name: string) {
    const state = this.locks.get(name);
    if (!state) return;
    state.held = false;
    this.pump(state);
    if (!state.held && state.queue.length === 0) this.locks.delete(name);
  }

  private pump(state: LockState) {
    if (state.held) return;
    const next = state.queue.shift();
    if (!next) return;
    state.held = true;
    next();
  }

  installClient() {
    const navigatorObject = globalThis.navigator ?? {};
    if (!globalThis.navigator) {
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigatorObject });
    }
    Object.defineProperty(navigatorObject, "locks", {
      configurable: true,
      value: this.lockManager,
    });
  }

  connectWorker(worker: NodeWorker) {
    const pending = new Map<string, () => void>();
    let disposed = false;
    const onMessage = (message: unknown) => {
      if (!isLockMessage(message)) return;
      if (message.type === "release") {
        pending.get(message.requestId)?.();
        pending.delete(message.requestId);
        return;
      }
      this.workerRequestCount += 1;
      void this.lockManager.request(message.name, async () => {
        if (disposed) return;
        worker.postMessage({ protocol, type: "granted", requestId: message.requestId });
        await new Promise<void>((resolve) => pending.set(message.requestId, resolve));
      });
    };
    const onExit = () => {
      disposed = true;
      for (const release of pending.values()) release();
      pending.clear();
    };
    worker.on("message", onMessage);
    worker.once("exit", onExit);
    return {
      dispose() {
        worker.off("message", onMessage);
        worker.off("exit", onExit);
        onExit();
      },
      isProtocolMessage: isLockMessage,
    };
  }
}

export function workerWebLocksBootstrapSource(forceMissingLocks = false) {
  return `
    const lockProtocol = ${JSON.stringify(protocol)};
    const lockCallbacks = new Map();
    let lockSequence = 0;
    const navigatorObject = globalThis.navigator || {};
    if (!globalThis.navigator) {
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigatorObject });
    }
    ${forceMissingLocks ? "Object.defineProperty(navigatorObject, 'locks', { configurable: true, value: undefined });" : ""}
    const bridgedLocks = {
      request(name, callback) {
        const requestId = \`worker-lock-\${++lockSequence}\`;
        return new Promise((resolve, reject) => {
          lockCallbacks.set(requestId, { callback, name, resolve, reject });
          parentPort.postMessage({ protocol: lockProtocol, type: "request", requestId, name });
        });
      }
    };
    Object.defineProperty(navigatorObject, "locks", { configurable: true, value: bridgedLocks });
    parentPort.on("message", (message) => {
      if (message?.protocol !== lockProtocol || message.type !== "granted") return;
      const pending = lockCallbacks.get(message.requestId);
      if (!pending) return;
      Promise.resolve()
        .then(() => pending.callback({ name: pending.name, mode: "exclusive" }))
        .then(pending.resolve, pending.reject)
        .finally(() => {
          lockCallbacks.delete(message.requestId);
          parentPort.postMessage({ protocol: lockProtocol, type: "release", requestId: message.requestId });
        });
    });
  `;
}
