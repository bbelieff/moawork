import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/lib/types";
import { SupabaseCrmError, SupabaseCrmSource } from "./supabaseCrmSource";

/**
 * PostgREST 쿼리 빌더 최소 흉내 — 체인 호출을 기록하고 준비된 행을 돌려준다.
 * 실제 Supabase 없이 **필터 조건(=담당범위)과 행→도메인 매핑**을 검증하는 것이 목적이다.
 */
type Filter = [string, unknown];

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  readonly filters: Filter[] = [];
  constructor(
    private readonly result: { data: unknown; error: unknown },
    private readonly log: { table: string; filters: Filter[] }[],
    private readonly table: string,
  ) {}
  select() {
    return this;
  }
  insert(payload: unknown) {
    this.inserted = payload;
    return this;
  }
  update(payload: unknown) {
    this.updated = payload;
    return this;
  }
  eq(k: string, v: unknown) {
    this.filters.push([k, v]);
    return this;
  }
  order() {
    return this;
  }
  maybeSingle() {
    return this.settle();
  }
  single() {
    return this.settle();
  }
  inserted: unknown;
  updated: unknown;

  private settle() {
    this.log.push({ table: this.table, filters: this.filters });
    return Promise.resolve(this.result);
  }
  then<A, B = never>(
    onOk?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null,
    onErr?: ((r: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    this.log.push({ table: this.table, filters: this.filters });
    return Promise.resolve(this.result).then(onOk, onErr);
  }
}

function fakeDb(
  byTable: Record<string, { data: unknown; error?: unknown }>,
  rpcResult: { data: unknown; error?: unknown } = { data: null },
) {
  const log: { table: string; filters: Filter[] }[] = [];
  const queries: FakeQuery[] = [];
  const db = {
    from(table: string) {
      const r = byTable[table] ?? { data: [] };
      const q = new FakeQuery({ data: r.data, error: r.error ?? null }, log, table);
      queries.push(q);
      return q;
    },
    rpc: vi.fn().mockResolvedValue({ data: rpcResult.data, error: rpcResult.error ?? null }),
  } as unknown as SupabaseClient;
  return { db, log, queries, rpc: db.rpc as ReturnType<typeof vi.fn> };
}

function ctxOf(role: Ctx["role"], scope: Ctx["scope"]): Ctx {
  return {
    user: { id: "u1", email: "u1@x.test", name: "U1" },
    org: { id: "o1", name: "Org", plan_tier: "basic" },
    role,
    scope,
  } as Ctx;
}

const DEAL_ROW = {
  id: "d1",
  org_id: "o1",
  company_id: "c1",
  pipeline_id: "p1",
  stage_id: "s1",
  assigned_to: "u1",
  title: "딜",
  amount: "1500000", // numeric 이 문자열로 오는 경우
  status_note: null,
  fee_terms: null,
  applied_on: "2026-07-01",
  custom: null, // null 이면 {} 로 수렴해야 한다
  created_at: "2026-07-21T00:00:00Z",
  updated_at: "2026-07-21T00:00:00Z",
  case_version: 2,
};

describe("SupabaseCrmSource — 담당범위 필터", () => {
  it("member+assigned 는 org + 본인 담당으로 필터한다", async () => {
    const { db, log } = fakeDb({ deals: { data: [DEAL_ROW] } });
    await new SupabaseCrmSource(db).listDeals(ctxOf("member", "assigned"));
    expect(log[0].filters).toEqual([
      ["org_id", "o1"],
      ["assigned_to", "u1"],
    ]);
  });

  it("owner 는 org 전체(담당 필터 없음)", async () => {
    const { db, log } = fakeDb({ deals: { data: [DEAL_ROW] } });
    await new SupabaseCrmSource(db).listDeals(ctxOf("owner", "assigned"));
    expect(log[0].filters).toEqual([["org_id", "o1"]]);
  });

  it("scope=all 이면 member 여도 org 전체", async () => {
    const { db, log } = fakeDb({ companies: { data: [] } });
    await new SupabaseCrmSource(db).listCompanies(ctxOf("member", "all"));
    expect(log[0].filters).toEqual([["org_id", "o1"]]);
  });
});

describe("SupabaseCrmSource — 행 매핑", () => {
  it("numeric 문자열은 숫자로, custom null 은 {} 로 수렴한다", async () => {
    const { db } = fakeDb({ deals: { data: [DEAL_ROW] } });
    const [deal] = await new SupabaseCrmSource(db).listDeals(ctxOf("owner", "all"));
    expect(deal.amount).toBe(1500000);
    expect(deal.custom).toEqual({});
    expect(deal.id).toBe("d1");
  });

  it("빈 결과(data=null)는 빈 배열", async () => {
    const { db } = fakeDb({ deals: { data: null } });
    expect(await new SupabaseCrmSource(db).listDeals(ctxOf("owner", "all"))).toEqual([]);
  });
});

describe("SupabaseCrmSource — 가시성", () => {
  it("남의 딜은 단건 조회에서 undefined 로 감춘다(존재 유출 방지)", async () => {
    const { db } = fakeDb({
      deals: { data: { ...DEAL_ROW, assigned_to: "other" } },
    });
    const got = await new SupabaseCrmSource(db).getDeal(
      ctxOf("member", "assigned"),
      "d1",
    );
    expect(got).toBeUndefined();
  });

  it("상위 딜이 안 보이면 활동기록도 빈 배열", async () => {
    const { db } = fakeDb({
      deals: { data: { ...DEAL_ROW, assigned_to: "other" } },
      activities: { data: [{ id: "a1" }] },
    });
    const got = await new SupabaseCrmSource(db).listActivities(
      ctxOf("member", "assigned"),
      "d1",
    );
    expect(got).toEqual([]);
  });
});

describe("SupabaseCrmSource — 쓰기 규칙", () => {
  it("단계 이동은 expected Case version과 Activity를 묶은 canonical RPC만 호출한다", async () => {
    const { db, rpc, queries } = fakeDb(
      {
        deals: { data: DEAL_ROW },
        stages: { data: { id: "s2", pipeline_id: "p1", name: "다음", sort_order: 2, kind: "work" } },
      },
      { data: [{ case_id: "d1", version: 3, activity_id: "a1", stage_id: "s2", pipeline_id: "p1", replayed: false }] },
    );
    const moved = await new SupabaseCrmSource(db).moveDeal(ctxOf("member", "assigned"), "d1", "s2", { requestId: "00000000-0000-4000-8000-000000000001", expectedVersion: 2 });
    expect(rpc).toHaveBeenCalledWith("move_case_stage_with_activity", expect.objectContaining({
      p_org_id: "o1",
      p_case_id: "d1",
      p_stage_id: "s2",
      p_expected_version: 2,
      p_request_id: "00000000-0000-4000-8000-000000000001",
    }));
    expect(queries.every((query) => query.updated === undefined)).toBe(true);
    expect(moved?.id).toBe("d1");
  });

  it("commit 뒤 transport loss 재시도는 같은 requestId로 저장된 stage 결과를 replay한다", async () => {
    let deal = { ...DEAL_ROW };
    let dealVisible = true;
    let stageAvailable = true;
    let stageReads = 0;
    const rpc = vi.fn()
      .mockImplementationOnce(async () => {
        deal = { ...deal, stage_id: "s2", case_version: 3 };
        stageAvailable = false;
        throw new Error("transport lost after commit");
      })
      .mockResolvedValue({ data: [{ case_id: "d1", version: 3, activity_id: "a1", stage_id: "s2", pipeline_id: "p2", replayed: true }], error: null });
    const db = {
      from(table: string) {
        if (table === "stages") stageReads += 1;
        const data = table === "deals"
          ? (dealVisible ? deal : null)
          : (stageAvailable ? { id: "s2", pipeline_id: "p2", name: "다음", sort_order: 2, kind: "work" } : null);
        return new FakeQuery({ data, error: null }, [], table);
      },
      rpc,
    } as unknown as SupabaseClient;
    const source = new SupabaseCrmSource(db);
    const identity = { requestId: "00000000-0000-4000-8000-000000000099", expectedVersion: 2 };
    await expect(source.moveDeal(ctxOf("member", "assigned"), "d1", "s2", identity)).rejects.toThrow(/transport lost/);
    await expect(source.moveDeal(ctxOf("member", "assigned"), "d1", "s2", identity)).resolves.toMatchObject({ stage_id: "s2", pipeline_id: "p2", case_version: 3 });
    expect(stageReads).toBe(0);
    expect(rpc).toHaveBeenNthCalledWith(2, "move_case_stage_with_activity", expect.objectContaining({
      p_request_id: identity.requestId,
      p_expected_version: 2,
      p_content: null,
    }));
    dealVisible = false;
    await expect(source.moveDeal(ctxOf("member", "assigned"), "d1", "s2", identity)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("Activity append는 direct insert 대신 stable type/category RPC를 소비한다", async () => {
    const activity = { id: "a1", org_id: "o1", deal_id: "d1", type: "memo", content: "메모", actor: "u1", at: "2026-08-31T00:00:00Z" };
    const { db, rpc, queries } = fakeDb(
      { activities: { data: activity } },
      { data: [{ activity_id: "a1", replayed: false }] },
    );
    expect((await new SupabaseCrmSource(db).createActivity(ctxOf("member", "assigned"), {
      deal_id: "d1", type: "memo", content: "메모",
    }, "00000000-0000-4000-8000-000000000002")).id).toBe("a1");
    expect(rpc).toHaveBeenCalledWith("append_case_activity", expect.objectContaining({
      p_org_id: "o1",
      p_case_id: "d1",
      p_type_id: "activity.memo",
      p_category_id: "activity.category.note",
      p_request_id: "00000000-0000-4000-8000-000000000002",
    }));
    expect(queries.every((query) => query.inserted === undefined)).toBe(true);
  });

  it("오늘 할 일은 custom update와 Activity를 단일 receipt RPC로만 저장한다", async () => {
    const requestId = "00000000-0000-4000-8000-000000000003";
    const { db, rpc, queries } = fakeDb(
      { deals: { data: DEAL_ROW } },
      { data: [{ activity_id: "a-task", replayed: false }] },
    );
    const result = await new SupabaseCrmSource(db).mutateCaseTask(
      ctxOf("member", "assigned"),
      "d1",
      { kind: "postpone", dueDate: "2026-09-02", requestId },
    );

    expect(result).toEqual({ activityId: "a-task", replayed: false });
    expect(rpc).toHaveBeenCalledWith("mutate_case_task_with_activity", {
      p_org_id: "o1",
      p_case_id: "d1",
      p_request_id: requestId,
      p_patch: {
        due_date: "2026-09-02",
        task_status: null,
        task_completed_at: null,
      },
    });
    expect(queries.every((query) => query.updated === undefined && query.inserted === undefined)).toBe(true);
  });

  it("missing requestId와 RPC rollback 오류는 direct fallback 없이 실패한다", async () => {
    const { db, rpc, queries } = fakeDb(
      { deals: { data: DEAL_ROW } },
      { data: null, error: { message: "injected receipt failure", code: "P0001" } },
    );
    const source = new SupabaseCrmSource(db);
    await expect(source.mutateCaseTask(ctxOf("member", "assigned"), "d1", {
      kind: "complete",
      requestId: "",
    })).rejects.toThrow(/requestId/);
    expect(rpc).not.toHaveBeenCalled();
    await expect(source.mutateCaseTask(ctxOf("member", "assigned"), "d1", {
      kind: "complete",
      requestId: "00000000-0000-4000-8000-000000000004",
    })).rejects.toThrow(/injected receipt failure/);
    expect(queries.every((query) => query.updated === undefined && query.inserted === undefined)).toBe(true);
  });

  it("담당자 변경은 활동기록과 묶인 단일 RPC만 호출한다", async () => {
    const { db, rpc } = fakeDb({}, { data: { ...DEAL_ROW, assigned_to: "u2" } });
    const updated = await new SupabaseCrmSource(db).reassignDealWithActivity(
      ctxOf("owner", "all"),
      "d1",
      "u2",
      "U1 → U2",
    );
    expect(rpc).toHaveBeenCalledWith("reassign_deal_with_activity", {
      p_org_id: "o1",
      p_deal_id: "d1",
      p_assigned_to: "u2",
    });
    expect(updated?.assigned_to).toBe("u2");
  });

  it("임의 deals insert는 fail-closed이고 회사 canonical Case 경로만 허용한다", async () => {
    const { db, queries } = fakeDb({ deals: { data: DEAL_ROW } });
    await expect(new SupabaseCrmSource(db).createDeal(ctxOf("member", "assigned"), {
      title: "새 딜",
    })).rejects.toThrow(/create_company_case/);
    expect(queries).toHaveLength(0);
  });

  it("deleteDeal도 table delete 없이 fail-close한다", async () => {
    const { db, queries } = fakeDb({ deals: { data: DEAL_ROW } });
    await expect(new SupabaseCrmSource(db).deleteDeal(ctxOf("owner", "all"), "d1")).rejects.toThrow(/deletion is not supported/);
    expect(queries).toHaveLength(0);
  });

  it("ownership PATCH는 direct deals update 전에 fail-closed된다", async () => {
    const { db, queries } = fakeDb({ deals: { data: DEAL_ROW } });
    await expect(new SupabaseCrmSource(db).updateDeal(ctxOf("member", "assigned"), "d1", {
      title: "수정",
      assigned_to: "u2",
    })).rejects.toThrow(/전용 RPC/);
    expect(queries).toHaveLength(0);
  });
});

describe("SupabaseCrmSource — 오류", () => {
  it("PostgREST 오류는 SupabaseCrmError 로 올린다", async () => {
    const { db } = fakeDb({
      deals: { data: null, error: { message: "permission denied", code: "42501" } },
    });
    await expect(
      new SupabaseCrmSource(db).listDeals(ctxOf("owner", "all")),
    ).rejects.toBeInstanceOf(SupabaseCrmError);
  });
});
