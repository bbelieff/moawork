import { describe, expect, it } from "vitest";
import {
  blankChecklist,
  type ChecklistState,
} from "./checklist";
import {
  boardEntryFromRow,
  consultationModeForRow,
  consultationProgressSummary,
  consultationViewLabel,
  contractStepGroupKey,
  filterRowIdsByConsultationView,
  nextPendingStep,
  parseConsultationView,
  readConsultationBoardView,
  readConsultationBoardViewInChunks,
} from "./boardView";

function checklistOf(confirmed: readonly boolean[]): ChecklistState {
  const keys = [
    "contract_sent",
    "signed_copy_sent",
    "counterparty_signature_confirmed",
    "deposit_confirmed",
  ] as const;
  const base = blankChecklist();
  keys.forEach((key, index) => {
    if (confirmed[index]) base[key] = { confirmed: true, actorId: "user-1", at: "2026-09-26T10:00:00+09:00" };
  });
  return base;
}

function rowOf(itemId: string, overrides: Record<string, unknown> = {}) {
  return {
    item_id: itemId,
    deal_id: "deal-1",
    company_id: null,
    mode: "remote",
    version: 2,
    meeting_at: null,
    checklist: checklistOf([true, false, false, false]),
    ready: false,
    missing: ["서명본 발송"],
    seal_approved: false,
    seal_detail: "업무관리 이동을 먼저 선택해 주세요.",
    deal_stage_kind: "meeting",
    ...overrides,
  };
}

describe("boardView — 단계 보기 순수 도우미", () => {
  it("consultation 파라미터는 remote|inperson 만 인정한다", () => {
    expect(parseConsultationView("remote")).toBe("remote");
    expect(parseConsultationView("inperson")).toBe("inperson");
    expect(parseConsultationView("all")).toBeNull();
    expect(parseConsultationView("")).toBeNull();
    expect(parseConsultationView(undefined)).toBeNull();
    expect(parseConsultationView("REMOTE")).toBeNull();
  });

  it("미조회는 null 이다 — remote 로 때우지 않는다(F5). 적재된 레거시만 remote 의도 기본값이다", () => {
    expect(consultationModeForRow("missing", {})).toBeNull();
    expect(
      consultationModeForRow("a", { a: boardEntryFromRow(rowOf("a", { mode: "inperson" })) }),
    ).toBe("inperson");
    // 적재된 레거시 remote 는 맵 안의 명시 값이다(의도된 기본값).
    expect(
      consultationModeForRow("a", { a: boardEntryFromRow(rowOf("a", { mode: "remote" })) }),
    ).toBe("remote");
  });

  it("같은 정본 id 를 mode 로 가른다 — 복제 없음", () => {
    const map = {
      a: boardEntryFromRow(rowOf("a", { mode: "remote" })),
      b: boardEntryFromRow(rowOf("b", { mode: "inperson" })),
    };
    expect(filterRowIdsByConsultationView(["a", "b"], map, "remote")).toEqual(["a"]);
    expect(filterRowIdsByConsultationView(["a", "b"], map, "inperson")).toEqual(["b"]);
    expect(filterRowIdsByConsultationView(["a", "b"], map, "all")).toEqual(["a", "b"]);
  });

  it("진행 요약은 n/4 와 다음 단계 라벨을 함께 준다", () => {
    expect(consultationProgressSummary(checklistOf([true, true, false, false]))).toEqual({
      done: 2,
      total: 4,
      nextLabel: "상대 서명 확인",
    });
    expect(consultationProgressSummary(checklistOf([true, true, true, true]))).toEqual({
      done: 4,
      total: 4,
      nextLabel: null,
    });
  });

  it("계약 단계 그룹 키는 첫 미완료 단계다", () => {
    expect(nextPendingStep(checklistOf([true, false, false, false]))).toBe("signed_copy_sent");
    expect(contractStepGroupKey(checklistOf([true, false, false, false]))).toBe("signed_copy_sent");
    expect(contractStepGroupKey(checklistOf([true, true, true, true]))).toBe("done");
  });

  it("보기 라벨은 Sidebar 와 같은 말을 쓴다", () => {
    expect(consultationViewLabel("remote")).toBe("비대면 상담");
    expect(consultationViewLabel("inperson")).toBe("대면 상담");
  });

  it("형식이 깨진 행은 조용히 넘기지 않고 던진다", () => {
    expect(() => boardEntryFromRow(rowOf("a", { mode: "weird" }))).toThrow(/형식/);
  });

  it("일괄 조회는 한 번의 RPC 로 끝난다", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { data: [rowOf("a"), rowOf("b", { mode: "inperson" })], error: null };
      },
    };
    const map = await readConsultationBoardView(client, { orgId: "org-1", boardId: "board-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      name: "read_consultation_board_view_v2",
      args: { p_org_id: "org-1", p_board_id: "board-1" },
    });
    expect(Object.keys(map).sort()).toEqual(["a", "b"]);
    expect(map.b.mode).toBe("inperson");
  });

  it("조회 실패는 서버 메시지를 그대로 던진다", async () => {
    const client = {
      rpc: async () => ({ data: null, error: { message: "boom", code: "42501" } }),
    };
    const caught = await readConsultationBoardView(client, { orgId: "org-1", boardId: "board-1" }).catch(
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("boom");
    expect((caught as { code?: string }).code).toBe("42501");
  });

  it("F5: 미조회는 특정 보기에서 제외되고 전체에서만 보인다", () => {
    const map = { a: boardEntryFromRow(rowOf("a", { mode: "remote" })) };
    expect(filterRowIdsByConsultationView(["a", "missing"], map, "remote")).toEqual(["a"]);
    expect(filterRowIdsByConsultationView(["a", "missing"], map, "inperson")).toEqual([]);
    expect(filterRowIdsByConsultationView(["a", "missing"], map, "all")).toEqual(["a", "missing"]);
  });

  it("F7: bounded IDs·pagination 을 RPC 에 그대로 넘긴다", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { data: [], error: null };
      },
    };
    await readConsultationBoardView(client, {
      orgId: "org-1",
      boardId: "board-1",
      itemIds: ["a", "b"],
      limit: 200,
      offset: 0,
    });
    expect(calls[0].args).toMatchObject({
      p_org_id: "org-1",
      p_board_id: "board-1",
      p_item_ids: ["a", "b"],
      p_limit: 200,
      p_offset: 0,
    });
  });

  it("F7: chunk 읽기는 200씩 나눠 합친다", async () => {
    const calls: string[][] = [];
    const client = {
      rpc: async (_name: string, args: Record<string, unknown>) => {
        calls.push([...(args.p_item_ids as string[])]);
        return { data: [], error: null };
      },
    };
    const ids = Array.from({ length: 450 }, (_, i) => `id-${i}`);
    await readConsultationBoardViewInChunks(client, { orgId: "o", boardId: "b", itemIds: ids });
    expect(calls).toHaveLength(3);
    expect(calls[0]).toHaveLength(200);
    expect(calls[2]).toHaveLength(50);
  });
});
