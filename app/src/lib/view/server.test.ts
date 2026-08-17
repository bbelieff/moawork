import { describe, expect, it, vi } from "vitest";
import { requireActiveFixedPerson } from "./server";

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
