import { describe, expect, it, vi } from "vitest";
import { advanceNewLeadToContact, NewLeadAdvanceError } from "./advance";

describe("advanceNewLeadToContact", () => {
  it("calls the item/request overload and parses a committed result", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ status: "committed", deal_id: "deal-1", company_id: null, reason: null }],
      error: null,
    });
    await expect(advanceNewLeadToContact({ rpc } as never, {
      itemId: "item-1",
      requestId: "00000000-0000-4000-8000-000000000172",
    })).resolves.toEqual({ status: "committed", dealId: "deal-1", companyId: null, reason: null });
    expect(rpc).toHaveBeenCalledWith("advance_new_lead_to_contact", {
      p_item_id: "item-1",
      p_request_id: "00000000-0000-4000-8000-000000000172",
    });
  });

  it("maps authorization and contract failures to explicit user-safe messages", async () => {
    const denied = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } }) };
    await expect(advanceNewLeadToContact(denied as never, { itemId: "i", requestId: "r" }))
      .rejects.toEqual(expect.objectContaining({ message: "컨택 이동 권한이 없습니다.", code: "42501" }));

    const invalid = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "22023" } }) };
    await expect(advanceNewLeadToContact(invalid as never, { itemId: "i", requestId: "r" }))
      .rejects.toBeInstanceOf(NewLeadAdvanceError);
  });

  it("rejects malformed RPC rows instead of treating them as success", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: [], error: null }) };
    await expect(advanceNewLeadToContact(client as never, { itemId: "i", requestId: "r" }))
      .rejects.toThrow("컨택 이동 결과를 확인하지 못했습니다.");
  });
});
