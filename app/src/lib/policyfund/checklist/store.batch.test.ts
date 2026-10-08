import { describe, expect, it, vi } from "vitest";
import { SupabaseChecklistStore } from "./store";

function clientWith(rowsFor: (ids: string[]) => unknown[], error: unknown = null) {
  const inCalls: string[][] = [];
  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({
        in: (_column: string, ids: string[]) => {
          inCalls.push(ids);
          return Promise.resolve({ data: error ? null : rowsFor(ids), error });
        },
      }),
    }),
  }));
  return { client: { from } as never, inCalls, from };
}

describe("Issue 857 · 거래 체크리스트 한 번에 읽기", () => {
  it("거래 id 를 100개씩 묶어 묶음마다 한 번 읽고, 있는 것만 지도에 담는다", async () => {
    const ids = Array.from({ length: 250 }, (_, index) => `deal-${index}`);
    const { client, inCalls } = clientWith((chunk) => chunk.filter((id) => id.endsWith("7")).map((id) => ({ deal_id: id, product_id: "p", items_jsonb: [] })));
    const result = await new SupabaseChecklistStore(client).listDealChecklists("org-1", [...ids, "deal-7"]);
    expect(inCalls.map((chunk) => chunk.length)).toEqual([100, 100, 50]);
    expect(result.get("deal-7")).toEqual({ dealId: "deal-7", productId: "p", items: [] });
    expect(result.has("deal-1")).toBe(false);
  });

  it("거래가 없으면 읽지 않고, 읽기 실패는 던진다(전처럼 절이 오류로 끝난다)", async () => {
    const empty = clientWith(() => []);
    expect((await new SupabaseChecklistStore(empty.client).listDealChecklists("org-1", [])).size).toBe(0);
    expect(empty.from).not.toHaveBeenCalled();
    const failing = clientWith(() => [], { message: "denied" });
    await expect(new SupabaseChecklistStore(failing.client).listDealChecklists("org-1", ["deal-1"])).rejects.toThrow("denied");
  });
});
