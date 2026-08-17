import { describe, expect, it, vi } from "vitest";
import { requireActiveFixedPerson, resolveSavedPersonRuntime } from "./server";

describe("fixed-person organization boundary", () => {
  it.each(["cross-org", "inactive", "missing"])("fails closed for %s members", async () => {
    const lookup = vi.fn(async () => ({ active: false }));
    await expect(requireActiveFixedPerson("org-a", { personScope: "fixed", personScopeUserId: "member-b" }, lookup)).rejects.toThrow("active member");
    expect(lookup).toHaveBeenCalledWith("org-a", "member-b");
  });

  it("accepts an active member and revalidates every replay", async () => {
    const lookup = vi.fn(async () => ({ active: true }));
    const scope = { personScope: "fixed" as const, personScopeUserId: "member-a" };
    await requireActiveFixedPerson("org-a", scope, lookup);
    await requireActiveFixedPerson("org-a", scope, lookup);
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});

describe("saved-person request runtime", () => {
  const runtime = (scope: "viewer" | "team" | "fixed", fixed: string | null = null, active = ["viewer", "team-a", "team-b"]) =>
    resolveSavedPersonRuntime(
      "org-a", "board-a", "view-a", "viewer",
      async (orgId, boardId, viewId) => orgId === "org-a" && boardId === "board-a" && viewId === "view-a"
        ? { personScope: scope, personScopeUserId: fixed } : null,
      async () => active,
      async (_orgId, userId) => ({ viewer: "sales", "team-a": "sales", "team-b": "ops" }[userId] ?? null),
    );

  it("resolves viewer, same-team and fixed member sets from active current-org rows", async () => {
    await expect(runtime("viewer")).resolves.toMatchObject({ memberIds: ["viewer"] });
    await expect(runtime("team")).resolves.toMatchObject({ memberIds: ["viewer", "team-a"] });
    await expect(runtime("fixed", "team-b")).resolves.toMatchObject({ memberIds: ["team-b"] });
  });

  it.each([
    ["inactive", ["viewer"]],
    ["removed", ["viewer", "team-a"]],
    ["cross-org", ["viewer", "team-a", "team-b"]],
  ] as const)("fails closed for a %s fixed member", async (_case, active) => {
    await expect(runtime("fixed", "outside", [...active])).resolves.toMatchObject({ memberIds: [] });
  });

  it("does not reuse a removed member across request replays", async () => {
    await expect(runtime("fixed", "team-b")).resolves.toMatchObject({ memberIds: ["team-b"] });
    await expect(runtime("fixed", "team-b", ["viewer", "team-a"])).resolves.toMatchObject({ memberIds: [] });
  });
});
