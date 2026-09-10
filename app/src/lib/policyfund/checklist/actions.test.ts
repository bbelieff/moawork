import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ saveExact: vi.fn(), saveAsPresetExact: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ org: { id: "org-1" }, user: { id: "user-1" } })),
}));
vi.mock("@/lib/supabase/local-fallback", () => ({ canUseLocalSeedFallback: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: vi.fn(async () => ({ kind: "allowed" })) }));
vi.mock("./store", () => ({ LocalChecklistStore: class {}, SupabaseChecklistStore: class {} }));
vi.mock("./service", () => ({
  ChecklistService: class {
    saveExact = mocks.saveExact;
    saveAsPresetExact = mocks.saveAsPresetExact;
  },
}));

import { mutateChecklistAction, saveChecklistAsPresetAction } from "./actions";

function form(productId: unknown) {
  const value = new FormData();
  value.set("dealId", "deal-1");
  value.set("requestId", "request-1");
  value.set("expectedVersion", "0");
  value.set("state", JSON.stringify({ productId, items: [], version: 0 }));
  return value;
}

describe("checklist action product identity", () => {
  beforeEach(() => {
    mocks.saveExact.mockReset().mockResolvedValue({ caseId: "deal-1", dealId: "deal-1", productId: null, items: [], version: 0 });
    mocks.saveAsPresetExact.mockReset().mockResolvedValue({ productId: "product", items: [], updatedAt: "2026-08-31T00:00:00.000Z" });
  });

  it("fails malformed product ids closed before service/store mutation", async () => {
    for (const productId of [1, {}, []]) {
      await expect(mutateChecklistAction(form(productId))).rejects.toThrow(/schema invalid/);
      await expect(saveChecklistAsPresetAction(form(productId))).rejects.toThrow(/schema invalid/);
    }
    expect(mocks.saveExact).not.toHaveBeenCalled();
    expect(mocks.saveAsPresetExact).not.toHaveBeenCalled();
  });

  it("keeps explicit null as the only valid product-clear intent", async () => {
    await expect(mutateChecklistAction(form(null))).resolves.toMatchObject({ productId: null });
    expect(mocks.saveExact).toHaveBeenCalledWith(expect.objectContaining({ productId: null }), {
      requestId: "request-1",
      expectedVersion: 0,
    });
  });
});
