import { beforeEach, describe, expect, it } from "vitest";
import { LocalWorkManagementSource, resetLocalWorkManagementForTest } from "./local-source";
import type { Ctx } from "@/lib/types";

const ctx = (orgId: string): Ctx => ({ org: { id: orgId, name: orgId, plan_tier: "test", created_at: "2026-01-01T00:00:00Z" }, user: { id: `user-${orgId}`, email: null, name: "로컬 사용자", avatar_url: null, created_at: "2026-01-01T00:00:00Z" }, role: "owner", scope: "all", isPlatformAdmin: false });
const asRole = (orgId: string, role: Ctx["role"], userId: string): Ctx => ({ ...ctx(orgId), role, user: { ...ctx(orgId).user, id: userId } });
beforeEach(resetLocalWorkManagementForTest);

describe("BBE-210 local work-management source", () => {
  it("persists CRUD across a fresh composition and refresh", async () => {
    const first = new LocalWorkManagementSource(ctx("org-a")); const initial = await first.load("org-a");
    const requestId = crypto.randomUUID();
    const result = await first.execute({ operation: "create_item", orgId: "org-a", boardId: initial.board.id, expectedVersion: 0, requestId, payload: { name: "로컬 업무" } });
    expect(result).toMatchObject({ accepted: true, replayed: false, version: 1 });
    expect(await first.execute({ operation: "create_item", orgId: "org-a", boardId: initial.board.id, expectedVersion: 0, requestId, payload: { name: "로컬 업무" } })).toMatchObject({ replayed: true });
    const refreshed = await new LocalWorkManagementSource(ctx("org-a")).load("org-a");
    expect(refreshed.items.map((item) => item.title)).toEqual(["로컬 업무"]);
    await first.execute({ operation: "set_due_date", orgId: "org-a", boardId: initial.board.id, itemId: refreshed.items[0].id, expectedVersion: 1, requestId: crypto.randomUUID(), payload: { due_date: "2026-08-22" } });
    expect((await first.load("org-a")).items[0].dueDate).toBe("2026-08-22");
    await first.execute({ operation: "delete_item", orgId: "org-a", boardId: initial.board.id, itemId: refreshed.items[0].id, expectedVersion: 2, requestId: crypto.randomUUID(), payload: {} });
    expect((await first.load("org-a")).items).toHaveLength(0);
  });

  it("isolates organizations and fails closed on cross-org read/write", async () => {
    const a = new LocalWorkManagementSource(ctx("org-a")); const b = new LocalWorkManagementSource(ctx("org-b"));
    const boardA = (await a.load("org-a")).board;
    await a.execute({ operation: "create_item", orgId: "org-a", boardId: boardA.id, expectedVersion: 0, requestId: crypto.randomUUID(), payload: { name: "A only" } });
    expect((await b.load("org-b")).items).toHaveLength(0);
    await expect(a.load("org-b")).rejects.toThrow("cross-org read");
    await expect(b.execute({ operation: "create_item", orgId: "org-a", boardId: boardA.id, expectedVersion: 0, requestId: crypto.randomUUID(), payload: { name: "denied" } })).rejects.toThrow("cross-org write");
  });

  it("derives authorization per session instead of caching the first org visitor role", async () => {
    const owner = new LocalWorkManagementSource(asRole("org-a", "owner", "owner-a"));
    const board = (await owner.load("org-a")).board;
    const member = new LocalWorkManagementSource(asRole("org-a", "member", "member-a"));
    expect((await member.load("org-a")).role).toBe("assignee");
    await expect(member.execute({ operation: "create_group", orgId: "org-a", boardId: board.id, expectedVersion: 0, requestId: crypto.randomUUID(), payload: { name: "denied" } })).rejects.toThrow("permission denied");

    resetLocalWorkManagementForTest();
    const memberFirst = new LocalWorkManagementSource(asRole("org-a", "member", "member-a"));
    const memberBoard = (await memberFirst.load("org-a")).board;
    const ownerSecond = new LocalWorkManagementSource(asRole("org-a", "owner", "owner-a"));
    expect((await ownerSecond.load("org-a")).role).toBe("manager");
    await expect(ownerSecond.execute({ operation: "create_group", orgId: "org-a", boardId: memberBoard.id, expectedVersion: 0, requestId: crypto.randomUUID(), payload: { name: "allowed" } })).resolves.toMatchObject({ accepted: true });
  });
});
