import { describe, expect, it, vi } from "vitest";
import { OUTBOX_DRAIN_QUEUE } from "./register.js";
import { registerOutboxFromEnv } from "./runtime.js";

describe("outbox startup", () => {
  it("stays disabled instead of falling back to the general database identity", async () => {
    const boss = { createQueue: vi.fn(), work: vi.fn(), schedule: vi.fn() };
    await expect(registerOutboxFromEnv(boss as never, {
      DATABASE_URL: "must-not-be-used",
      SOLAPI_API_KEY: "key",
      SOLAPI_API_SECRET: "secret",
    })).resolves.toBeNull();
    expect(boss.createQueue).not.toHaveBeenCalled();
  });

  it("registers the drain worker and recurring ingress with the constrained identity", async () => {
    const boss = {
      createQueue: vi.fn().mockResolvedValue(undefined),
      work: vi.fn().mockResolvedValue("worker"),
      schedule: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = await registerOutboxFromEnv(boss as never, {
      OUTBOX_DATABASE_URL: "postgres://user:pass@127.0.0.1:1/db",
      OUTBOX_WORKER_ID: "worker-a",
      SOLAPI_API_KEY: "key",
      SOLAPI_API_SECRET: "secret",
    });
    expect(boss.createQueue).toHaveBeenCalledWith(OUTBOX_DRAIN_QUEUE, expect.any(Object));
    expect(boss.work).toHaveBeenCalledWith(OUTBOX_DRAIN_QUEUE, expect.any(Function));
    expect(boss.schedule).toHaveBeenCalledWith(OUTBOX_DRAIN_QUEUE, "* * * * *");
    await runtime?.stop();
  });
});
