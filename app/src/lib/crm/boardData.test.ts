import { describe, expect, it } from "vitest";
import type { Company, Ctx, Deal, Pipeline, Stage } from "@/lib/types";
import type { CrmSource } from "@/lib/repo/supabase";
import { isSupabaseConfigured, readSupabaseEnv } from "@/lib/repo/supabase";
import { loadStageBoard } from "./boardData";
import { getStageBoard } from "./stageBoards";

const ctx = {
  user: { id: "u1" },
  org: { id: "o1" },
  role: "owner",
  scope: "all",
} as Ctx;

function stage(id: string, kind: Stage["kind"], sort_order = 0): Stage {
  return { id, pipeline_id: "p1", name: id, sort_order, kind };
}

function deal(id: string, stage_id: string | null, company_id?: string): Deal {
  return {
    id,
    org_id: "o1",
    company_id: company_id ?? null,
    pipeline_id: "p1",
    stage_id,
    assigned_to: "u1",
    title: id,
    amount: null,
    status_note: null,
    fee_terms: null,
    applied_on: null,
    custom: {},
    created_at: "2026-07-21T00:00:00Z",
    updated_at: "2026-07-21T00:00:00Z",
  };
}

function fakeSource(over: Partial<CrmSource> = {}): CrmSource {
  const base: CrmSource = {
    kind: "local",
    listPipelines: async () => [{ id: "p1", org_id: "o1", name: "기본" } as Pipeline],
    listStages: async () => [stage("s-work", "work"), stage("s-mkt", "marketing")],
    getStage: async () => undefined,
    listCompanies: async () => [],
    getCompany: async () => undefined,
    createCompany: async () => ({}) as Company,
    updateCompany: async () => undefined,
    deleteCompany: async () => false,
    listDeals: async () => [],
    getDeal: async () => undefined,
    createDeal: async () => ({}) as Deal,
    updateDeal: async () => undefined,
    reassignDealWithActivity: async () => undefined,
    moveDeal: async () => undefined,
    deleteDeal: async () => false,
    listActivities: async () => [],
    createActivity: async () => ({}) as never,
  };
  return { ...base, ...over };
}

const workBoard = getStageBoard("work")!;

describe("loadStageBoard", () => {
  it("보드 kind 에 해당하는 단계의 딜만 담는다", async () => {
    const data = await loadStageBoard(
      ctx,
      workBoard,
      fakeSource({
        listDeals: async () => [deal("d1", "s-work"), deal("d2", "s-mkt")],
      }),
    );
    expect(data.total).toBe(1);
    expect(data.columns.map((c) => c.stage.id)).toEqual(["s-work"]);
    expect(data.columns[0].deals.map((d) => d.id)).toEqual(["d1"]);
  });

  it("파이프라인이 여러 개면 같은 kind 단계를 한 보드에 모은다", async () => {
    const data = await loadStageBoard(
      ctx,
      workBoard,
      fakeSource({
        listPipelines: async () =>
          [
            { id: "p1", org_id: "o1", name: "A" },
            { id: "p2", org_id: "o1", name: "B" },
          ] as Pipeline[],
        listStages: async (pid: string) => [stage(`s-${pid}`, "work")],
        listDeals: async () => [deal("d1", "s-p1"), deal("d2", "s-p2")],
      }),
    );
    expect(data.total).toBe(2);
    expect(data.columns).toHaveLength(2);
  });

  it("단계가 없으면 빈 보드(컬럼 0)", async () => {
    const data = await loadStageBoard(
      ctx,
      workBoard,
      fakeSource({ listStages: async () => [] }),
    );
    expect(data.columns).toEqual([]);
    expect(data.total).toBe(0);
  });

  it("딜이 없으면 고객사를 조회하지 않는다(불필요 쿼리 방지)", async () => {
    let called = false;
    await loadStageBoard(
      ctx,
      workBoard,
      fakeSource({
        listDeals: async () => [],
        listCompanies: async () => {
          called = true;
          return [];
        },
      }),
    );
    expect(called).toBe(false);
  });

  it("딜의 업체명을 붙일 수 있도록 company 맵을 만든다", async () => {
    const data = await loadStageBoard(
      ctx,
      workBoard,
      fakeSource({
        listDeals: async () => [deal("d1", "s-work", "c1")],
        listCompanies: async () => [{ id: "c1", name: "가나상사" } as Company],
      }),
    );
    expect(data.companyById.get("c1")?.name).toBe("가나상사");
  });

  it("소스 종류를 그대로 전달한다(화면 배지용)", async () => {
    const data = await loadStageBoard(ctx, workBoard, fakeSource({ kind: "supabase" }));
    expect(data.sourceKind).toBe("supabase");
  });
});

describe("Supabase 환경변수", () => {
  it("둘 다 있어야 설정된 것으로 본다", () => {
    expect(
      isSupabaseConfigured({
        NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      }),
    ).toBe(true);
    expect(
      isSupabaseConfigured({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" }),
    ).toBe(false);
    expect(isSupabaseConfigured({})).toBe(false);
  });

  it("공백만 든 값은 미설정으로 친다", () => {
    expect(
      readSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "  ",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      }),
    ).toBeNull();
  });
});
