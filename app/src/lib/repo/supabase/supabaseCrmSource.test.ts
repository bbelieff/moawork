import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/lib/types";
import { NewcustCutoverConflictError, SupabaseCrmError, SupabaseCrmSource } from "./supabaseCrmSource";

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

describe("newcust cutover fence", () => {
  it("cutover DB fence만 명시적 domain conflict로 변환한다", async () => {
    const { db } = fakeDb({ deals: { data: null, error: { message: "NEWCUST_CUTOVER_FENCE", code: "P0001" } } });
    await expect(new SupabaseCrmSource(db).createDeal(ctxOf("owner", "all"), { title: "synthetic" })).rejects.toBeInstanceOf(NewcustCutoverConflictError);
  });
});

function fakeDb(byTable: Record<string, { data: unknown; error?: unknown }>) {
  const log: { table: string; filters: Filter[] }[] = [];
  const queries: FakeQuery[] = [];
  const db = {
    from(table: string) {
      const r = byTable[table] ?? { data: [] };
      const q = new FakeQuery({ data: r.data, error: r.error ?? null }, log, table);
      queries.push(q);
      return q;
    },
  } as unknown as SupabaseClient;
  return { db, log, queries };
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
  applied_on: "2026-07-01",
  custom: null, // null 이면 {} 로 수렴해야 한다
  created_at: "2026-07-21T00:00:00Z",
  updated_at: "2026-07-21T00:00:00Z",
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
  it("일반 멤버가 만든 딜은 본인 담당으로 고정된다", async () => {
    const { db, queries } = fakeDb({ deals: { data: DEAL_ROW } });
    await new SupabaseCrmSource(db).createDeal(ctxOf("member", "assigned"), {
      title: "새 딜",
      assigned_to: "someone-else", // 무시되어야 한다
    });
    expect((queries[0].inserted as { assigned_to: string }).assigned_to).toBe("u1");
  });

  it("매니저는 타인에게 배정할 수 있다", async () => {
    const { db, queries } = fakeDb({ deals: { data: DEAL_ROW } });
    await new SupabaseCrmSource(db).createDeal(ctxOf("admin", "all"), {
      title: "새 딜",
      assigned_to: "u2",
    });
    expect((queries[0].inserted as { assigned_to: string }).assigned_to).toBe("u2");
  });

  it("일반 멤버의 재배정 시도는 패치에서 제거된다", async () => {
    const { db, queries } = fakeDb({ deals: { data: DEAL_ROW } });
    await new SupabaseCrmSource(db).updateDeal(ctxOf("member", "assigned"), "d1", {
      title: "수정",
      assigned_to: "u2",
    });
    // queries[0] = getDeal(가시성 확인), queries[1] = update
    expect(queries[1].updated).not.toHaveProperty("assigned_to");
    expect(queries[1].updated).toMatchObject({ title: "수정" });
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
