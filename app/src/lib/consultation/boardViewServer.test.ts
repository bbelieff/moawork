import { describe, expect, it } from "vitest";
import { loadConsultationBoardView } from "./boardViewServer";

function rowOf(itemId: string) {
  return {
    item_id: itemId,
    deal_id: "deal-1",
    company_id: null,
    mode: "remote",
    version: 1,
    meeting_at: null,
    checklist: {
      contract_sent: { confirmed: true, actor: "u", at: "2026-09-26T10:00:00+09:00" },
      signed_copy_sent: { confirmed: false, actor: null, at: null },
      counterparty_signature_confirmed: { confirmed: false, actor: null, at: null },
      deposit_confirmed: { confirmed: false, actor: null, at: null },
    },
    ready: false,
    missing: [],
    seal_approved: false,
    seal_detail: "",
    deal_stage_kind: "meeting",
  };
}

describe("boardViewServer — 단계 보기 서버 적재", () => {
  it("허용 목록과 교집합해 fail-closed 로 좁힌다", async () => {
    const client = {
      rpc: async () => ({ data: [rowOf("a"), rowOf("b")], error: null }),
    };
    const result = await loadConsultationBoardView(client, {
      orgId: "org-1",
      boardId: "board-1",
      visibleItemIds: new Set(["a"]),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.entries)).toEqual(["a"]);
      expect(result.entries.a.version).toBe(1);
    }
  });

  it("RPC 실패는 던지지 않고 ok:false 로 돌려준다", async () => {
    const client = {
      rpc: async () => ({ data: null, error: { message: "42883 없음", code: "42883" } }),
    };
    const result = await loadConsultationBoardView(client, {
      orgId: "org-1",
      boardId: "board-1",
      visibleItemIds: new Set(["a"]),
    });
    expect(result).toMatchObject({ ok: false });
  });

  it("F7: 후보 ID bounded 로 읽고 visible 과 좁힌다", async () => {
    const seen: Record<string, unknown>[] = [];
    const client = {
      rpc: async (_name: string, args: Record<string, unknown>) => {
        seen.push(args);
        const wanted = new Set((args.p_item_ids as string[]) ?? []);
        return { data: ["a", "b", "c"].filter((id) => wanted.has(id)).map(rowOf), error: null };
      },
    };
    const result = await loadConsultationBoardView(client, {
      orgId: "org-1",
      boardId: "board-1",
      visibleItemIds: new Set(["a", "b"]),
      candidateItemIds: ["a", "b", "c"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.entries).sort()).toEqual(["a", "b"]);
    // 후보를 visible 로 먼저 좁혀 보내므로 c 는 SQL 에 가지 않는다.
    expect(seen).toHaveLength(1);
    expect(seen[0].p_item_ids).toEqual(["a", "b"]);
  });

  it("F7: 빈 후보는 RPC 없이 빈 맵이다", async () => {
    let called = 0;
    const client = {
      rpc: async () => {
        called += 1;
        return { data: [], error: null };
      },
    };
    const result = await loadConsultationBoardView(client, {
      orgId: "org-1",
      boardId: "board-1",
      visibleItemIds: new Set(["a"]),
      candidateItemIds: [],
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(Object.keys(result.entries)).toEqual([]);
    expect(called).toBe(0);
  });
});
