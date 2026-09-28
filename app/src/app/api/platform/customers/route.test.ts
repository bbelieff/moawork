import { describe, expect, it } from "vitest";
import { handleCustomerList } from "./handlers";
import { handleCustomerDetail, handleCustomerPatch } from "./[id]/handlers";
import { handleTaskCreate, handleTaskStatus } from "./[id]/tasks/handlers";
import type { CustomerRpcClient } from "@/lib/platform/customers/server";

const ORG = "00000000-0000-4000-8000-0000000000a1";
const TASK = "00000000-0000-4000-8000-000000000071";

const summary = {
  org_id: ORG,
  name: "알파 회사",
  slug: "alpha",
  org_status: "active",
  industry: "경영컨설팅",
  setup_status: "setting_up",
  invite_state: "pending",
  member_count: 1,
  open_task_count: 0,
  updated_at: "2026-09-17T00:00:00Z",
};

const detail = { ...summary, has_rep: false, can_enter: true, can_manage: true, template: { key: null, applied_at: null } };

function actor(kind: "granted" | "unauthenticated" | "not_platform" | "unavailable") {
  return async () => {
    if (kind === "granted") return { kind: "granted" as const };
    if (kind === "unauthenticated") return { kind: "denied" as const, reason: "unauthenticated" as const };
    if (kind === "not_platform") return { kind: "denied" as const, reason: "not_platform" as const };
    return { kind: "unavailable" as const };
  };
}

function client(data: Record<string, unknown>): () => Promise<CustomerRpcClient> {
  return async () => ({
    rpc: async (name: string) => {
      const value = data[name];
      if (value instanceof Error) return { data: null, error: value as { code?: string | null } };
      return { data: value, error: null };
    },
  });
}

const grantedClient = () => client({
  list_platform_customers: [summary],
  get_platform_customer: detail,
  list_platform_customer_tasks: [],
  list_platform_customer_history: [],
});

const post = (path: string, body: unknown) =>
  new Request(`https://www.moa-work.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const patch = (path: string, body: unknown) =>
  new Request(`https://www.moa-work.com${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("platform customers API", () => {
  it("closes the list to unauthenticated / non-platform / unavailable actors", async () => {
    await expect(handleCustomerList(new Request("https://www.moa-work.com/api/platform/customers"), actor("unauthenticated"), grantedClient()))
      .resolves.toMatchObject({ status: 401 });
    await expect(handleCustomerList(new Request("https://www.moa-work.com/api/platform/customers"), actor("not_platform"), grantedClient()))
      .resolves.toMatchObject({ status: 403 });
    await expect(handleCustomerList(new Request("https://www.moa-work.com/api/platform/customers"), actor("unavailable"), grantedClient()))
      .resolves.toMatchObject({ status: 503 });
  });

  it("lists narrow registry rows and never invents them when malformed", async () => {
    const response = await handleCustomerList(
      new Request("https://www.moa-work.com/api/platform/customers?q=알파&status=all"), actor("granted"), grantedClient());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, customers: [{ name: "알파 회사" }] });

    const broken = await handleCustomerList(
      new Request("https://www.moa-work.com/api/platform/customers"), actor("granted"), client({ list_platform_customers: [{ bad: true }] }));
    expect(broken.status).toBe(503);
  });

  it("rejects forged detail ids without granting anything", async () => {
    const forged = await handleCustomerDetail("alpha", { loadActor: actor("granted"), loadClient: grantedClient() });
    expect(forged.status).toBe(404);

    const missing = await handleCustomerDetail(ORG, {
      loadActor: actor("granted"),
      loadClient: client({
        get_platform_customer: Object.assign(new Error("customer not found"), { code: "P0002" }),
        list_platform_customer_tasks: [],
        list_platform_customer_history: [],
      }),
    });
    expect(missing.status).toBe(404);
  });

  it("patches one axis at a time and validates input", async () => {
    const both = await handleCustomerPatch(ORG, patch(`/api/platform/customers/${ORG}`, { setupStatus: "active", inviteState: "sent" }), {
      loadActor: actor("granted"), loadClient: grantedClient(),
    });
    expect(both.status).toBe(400);

    const neither = await handleCustomerPatch(ORG, patch(`/api/platform/customers/${ORG}`, {}), {
      loadActor: actor("granted"), loadClient: grantedClient(),
    });
    expect(neither.status).toBe(400);

    const ok = await handleCustomerPatch(ORG, patch(`/api/platform/customers/${ORG}`, { setupStatus: "active" }), {
      loadActor: actor("granted"),
      loadClient: client({ set_platform_customer_setup: { ok: true, changed: true } }),
    });
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toEqual({ ok: true, changed: true });

    const bad = await handleCustomerPatch(ORG, patch(`/api/platform/customers/${ORG}`, { setupStatus: "bogus" }), {
      loadActor: actor("granted"), loadClient: grantedClient(),
    });
    expect(bad.status).toBe(400);
  });

  it("creates tasks idempotently and validates the idempotency key", async () => {
    const created = await handleTaskCreate(ORG, post(`/api/platform/customers/${ORG}/tasks`, { taskId: TASK, title: "안내", kind: "setup" }), {
      loadActor: actor("granted"),
      loadClient: client({ create_platform_customer_task: { ok: true, created: true, task_id: TASK } }),
    });
    expect(created.status).toBe(201);

    const replay = await handleTaskCreate(ORG, post(`/api/platform/customers/${ORG}/tasks`, { taskId: TASK, title: "안내", kind: "setup" }), {
      loadActor: actor("granted"),
      loadClient: client({ create_platform_customer_task: { ok: true, created: false, task_id: TASK } }),
    });
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual({ ok: true, created: false, taskId: TASK });

    const noKey = await handleTaskCreate(ORG, post(`/api/platform/customers/${ORG}/tasks`, { title: "안내", kind: "setup" }), {
      loadActor: actor("granted"), loadClient: grantedClient(),
    });
    expect(noKey.status).toBe(400);

    const moved = await handleTaskStatus(ORG, TASK, patch(`/api/platform/customers/${ORG}/tasks/${TASK}`, { status: "done" }), {
      loadActor: actor("granted"),
      loadClient: client({ update_platform_customer_task: { ok: true, changed: true, task_id: TASK, status: "done" } }),
    });
    expect(moved.status).toBe(200);

    const badStatus = await handleTaskStatus(ORG, TASK, patch(`/api/platform/customers/${ORG}/tasks/${TASK}`, { status: "bogus" }), {
      loadActor: actor("granted"), loadClient: grantedClient(),
    });
    expect(badStatus.status).toBe(400);

    const forgedTask = await handleTaskStatus(ORG, "not-a-task", patch(`/api/platform/customers/${ORG}/tasks/x`, { status: "done" }), {
      loadActor: actor("granted"), loadClient: grantedClient(),
    });
    expect(forgedTask.status).toBe(404);
  });
});
