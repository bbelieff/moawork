import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetLocalWorkManagementForTest, LocalWorkManagementSource } from "@/lib/work-management/local-source";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => { throw new Error("production client must not run in local mode"); }) }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => ({ org: { id: "org-local", name: "로컬", plan_tier: "test", created_at: "2026-01-01T00:00:00Z" }, user: { id: "user-local", name: "로컬 사용자", email: null, avatar_url: null, created_at: "2026-01-01T00:00:00Z" }, role: "owner", scope: "all", isPlatformAdmin: false })) }));

import { mutateWork } from "./actions";
import { getSession } from "@/lib/auth/session";

beforeEach(resetLocalWorkManagementForTest);

describe("BBE-210 local work command action", () => {
  it("writes through the same local source that a refreshed page reads", async () => {
    const ctx = await getSession();
    const before = await new LocalWorkManagementSource(ctx).load(ctx.org.id);
    const form = new FormData();
    form.set("operation", "create_item"); form.set("boardId", before.board.id);
    form.set("expectedVersion", "0"); form.set("value", "액션으로 만든 업무");
    await expect(mutateWork({ ok: false, message: "" }, form)).resolves.toEqual({ ok: true, message: "Saved." });
    const refreshed = await new LocalWorkManagementSource(ctx).load(ctx.org.id);
    expect(refreshed.items.map((item) => item.title)).toEqual(["액션으로 만든 업무"]);
  });
});
