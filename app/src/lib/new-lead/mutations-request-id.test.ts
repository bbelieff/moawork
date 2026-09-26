import { describe, expect, it } from "vitest";
import {
  updateCanonicalNewLead,
  updateCanonicalNewLeadMeta,
} from "./mutations";

/**
 * 정본 RPC 재시도 이력 일치 검사 — 호출 횟수가 아니라 전달된 payload 이력으로
 * 멱등 키(requestId)가 같은 의도에서 안정적인지 본다.
 */
function fakeClient(history: { fn: string; args: Record<string, unknown> }[]) {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      history.push({ fn, args });
      if (fn === "update_new_lead_fields") {
        return { data: [{ deal_id: args.p_deal_id, changed_fields: ["representative_name"], replayed: history.length > 1 }], error: null };
      }
      return { data: [{ deal_id: args.p_deal_id, item_id: "item-1", changed_fields: ["address_detail"], replayed: history.length > 1 }], error: null };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("정본 RPC requestId 이력", () => {
  it("같은 의도 재시도는 같은 p_request_id로 기록된다", async () => {
    const history: { fn: string; args: Record<string, unknown> }[] = [];
    const client = fakeClient(history);
    const base = {
      orgId: "org-1",
      dealId: "deal-1",
      requestId: "stable-ocr-req",
      patch: { representative_name: "홍길동" },
      valueSource: "manual" as const,
    };
    await updateCanonicalNewLead(client, base);
    await updateCanonicalNewLead(client, base);
    expect(history).toHaveLength(2);
    expect(history[0].args.p_request_id).toBe("stable-ocr-req");
    expect(history[1].args.p_request_id).toBe("stable-ocr-req");
    expect(history[0].args).toEqual(history[1].args);
  });

  it("새 의도(편집 후)는 다른 p_request_id로 기록된다", async () => {
    const history: { fn: string; args: Record<string, unknown> }[] = [];
    const client = fakeClient(history);
    await updateCanonicalNewLeadMeta(client, {
      orgId: "org-1",
      dealId: "deal-1",
      requestId: "req-first",
      patch: { address_detail: "서울" },
    });
    await updateCanonicalNewLeadMeta(client, {
      orgId: "org-1",
      dealId: "deal-1",
      requestId: "req-second",
      patch: { address_detail: "서울 강남" },
    });
    expect(history).toHaveLength(2);
    expect(history[0].args.p_request_id).toBe("req-first");
    expect(history[1].args.p_request_id).toBe("req-second");
    expect(history[0].args.p_patch).not.toEqual(history[1].args.p_patch);
  });
});
