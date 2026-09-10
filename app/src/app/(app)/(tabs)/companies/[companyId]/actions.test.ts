import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ start: vi.fn(), redirect: vi.fn(), revalidate: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    mocks.redirect(href);
    throw new Error(`NEXT_REDIRECT:${href}`);
  },
}));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => ({ org: { id: "org-1" } })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/companies/start-work", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/companies/start-work")>(),
  startCompanyWork: mocks.start,
}));

import { startCompanyWorkAction } from "./actions";

function form(requestId: string) {
  const value = new FormData();
  value.set("companyId", "company-1");
  value.set("requestId", requestId);
  return value;
}

describe("company detail start-work action intent", () => {
  beforeEach(() => {
    mocks.start.mockReset();
    mocks.redirect.mockReset();
    mocks.revalidate.mockReset();
  });

  it("preserves the caller requestId across the actual unverifiable-result path", async () => {
    const requestId = "90000000-0000-4000-8000-000000000123";
    const actual = await vi.importActual<typeof import("@/lib/companies/start-work")>("@/lib/companies/start-work");
    mocks.start.mockImplementationOnce((_client, input) => actual.startCompanyWork({
      rpc: async () => ({
        data: [{ case_id: "case-1", item_id: "item-1", version: null, replayed: false }],
        error: null,
      }),
    }, input));
    await expect(startCompanyWorkAction(form(requestId))).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenLastCalledWith(
      `/companies/company-1?workStart=failed&requestId=${requestId}`,
    );
  });

  it("does not carry the completed intent into the success redirect", async () => {
    const requestId = "90000000-0000-4000-8000-000000000124";
    mocks.start.mockResolvedValueOnce({ dealId: "deal-1", itemId: "item-1", replayed: false });
    await expect(startCompanyWorkAction(form(requestId))).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenLastCalledWith("/companies/company-1?workStart=ok&dealId=deal-1");
  });

  it("rotates a terminal conflict instead of retaining its requestId", async () => {
    const requestId = "90000000-0000-4000-8000-000000000125";
    const actual = await vi.importActual<typeof import("@/lib/companies/start-work")>("@/lib/companies/start-work");
    mocks.start.mockImplementationOnce((_client, input) => actual.startCompanyWork({
      rpc: async () => ({ data: null, error: { code: "22023", message: "request mismatch" } }),
    }, input));
    await expect(startCompanyWorkAction(form(requestId))).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenLastCalledWith("/companies/company-1?workStart=failed");
  });

  it("coalesces a same-form double submit under the same caller requestId", async () => {
    const requestId = "90000000-0000-4000-8000-000000000126";
    mocks.start.mockResolvedValue({ dealId: "deal-1", itemId: "item-1", replayed: false });
    await Promise.allSettled([startCompanyWorkAction(form(requestId)), startCompanyWorkAction(form(requestId))]);
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(mocks.start.mock.calls.map((call) => call[1].requestId)).toEqual([requestId, requestId]);
  });
});
