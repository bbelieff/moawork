import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Company, Ctx, Deal, Pipeline, Stage } from "@/lib/types";
import type { CrmSource } from "@/lib/repo/supabase/source";
import {
  createFirstLead,
  createLocalFirstLead,
  FirstLeadError,
  normalizeFirstLeadInput,
} from "./first-lead";

const ctx = {
  user: { id: "user-1" },
  org: { id: "org-1" },
  role: "owner",
  scope: "all",
} as Ctx;

const requestId = "85cd9993-3434-45ed-a08a-3eb83c81c436";

function asClient(value: unknown): SupabaseClient {
  return value as SupabaseClient;
}

function localSource(overrides: Partial<CrmSource> = {}): CrmSource {
  return {
    kind: "local",
    listPipelines: async () =>
      [{ id: "pipeline-1", org_id: "org-1", name: "기본 파이프라인" }] as Pipeline[],
    listStages: async () =>
      [
        {
          id: "stage-1",
          pipeline_id: "pipeline-1",
          name: "마케팅",
          sort_order: 0,
          kind: "marketing",
        },
      ] as Stage[],
    listDeals: async () => [],
    createCompany: async () =>
      ({ id: "company-1", org_id: "org-1", name: "모아상사" }) as Company,
    createDeal: async () =>
      ({
        id: "deal-1",
        org_id: "org-1",
        company_id: "company-1",
        custom: {},
      }) as Deal,
    ...overrides,
  } as CrmSource;
}

describe("first lead input", () => {
  it("공백을 정리하고 빈 업무명은 업체명 기반으로 만든다", () => {
    expect(
      normalizeFirstLeadInput({
        requestId,
        companyName: "  모아상사  ",
        dealTitle: " ",
      }),
    ).toEqual({
      requestId,
      companyName: "모아상사",
      dealTitle: "모아상사 업무",
    });
  });

  it("잘못된 요청 UUID·빈 업체명·길이 초과를 거부한다", () => {
    expect(() =>
      normalizeFirstLeadInput({
        requestId: "not-a-uuid",
        companyName: "모아상사",
      }),
    ).toThrow(FirstLeadError);
    expect(() =>
      normalizeFirstLeadInput({ requestId, companyName: " " }),
    ).toThrow("업체명을 입력");
    expect(() =>
      normalizeFirstLeadInput({
        requestId,
        companyName: "가".repeat(161),
      }),
    ).toThrow("160자");
  });
});

describe("createFirstLead RPC", () => {
  it("조직·요청·정규화 입력만 RPC에 보내고 결과를 검증한다", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        org_id: "org-1",
        company_id: "company-1",
        deal_id: "deal-1",
        created: true,
      },
      error: null,
    });

    await expect(
      createFirstLead(asClient({ rpc }), ctx, {
        requestId,
        companyName: " 모아상사 ",
        dealTitle: "",
      }),
    ).resolves.toEqual({
      orgId: "org-1",
      companyId: "company-1",
      dealId: "deal-1",
      created: true,
    });
    expect(rpc).toHaveBeenCalledWith("create_first_lead", {
      p_org_id: "org-1",
      p_request_id: requestId,
      p_company_name: "모아상사",
      p_deal_title: "모아상사 업무",
    });
  });

  it("RPC 오류·잘못된 응답·다른 조직 결과를 성공으로 처리하지 않는다", async () => {
    await expect(
      createFirstLead(
        asClient({
          rpc: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "denied", code: "42501" },
          }),
        }),
        ctx,
        { requestId, companyName: "모아상사" },
      ),
    ).rejects.toMatchObject({ operation: "rpc", code: "42501" });

    await expect(
      createFirstLead(
        asClient({
          rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
        ctx,
        { requestId, companyName: "모아상사" },
      ),
    ).rejects.toMatchObject({ operation: "response" });

    await expect(
      createFirstLead(
        asClient({
          rpc: vi.fn().mockResolvedValue({
            data: {
              org_id: "org-other",
              company_id: "company-1",
              deal_id: "deal-1",
              created: true,
            },
            error: null,
          }),
        }),
        ctx,
        { requestId, companyName: "모아상사" },
      ),
    ).rejects.toThrow("조직이 일치");
  });
});

describe("createLocalFirstLead", () => {
  it("기본 marketing 단계에 본인 담당 업체·딜을 만든다", async () => {
    const createCompany = vi.fn(localSource().createCompany);
    const createDeal = vi.fn(localSource().createDeal);
    const source = localSource({ createCompany, createDeal });

    await expect(
      createLocalFirstLead(source, ctx, {
        requestId,
        companyName: "모아상사",
      }),
    ).resolves.toMatchObject({
      orgId: "org-1",
      companyId: "company-1",
      dealId: "deal-1",
      created: true,
    });
    expect(createCompany).toHaveBeenCalledWith(ctx, {
      name: "모아상사",
      assigned_to: "user-1",
    });
    expect(createDeal).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        company_id: "company-1",
        pipeline_id: "pipeline-1",
        stage_id: "stage-1",
        assigned_to: "user-1",
        custom: { _first_lead_request_id: requestId },
      }),
    );
  });

  it("같은 request 결과를 재사용하고 company가 사라진 결과는 재생성하지 않는다", async () => {
    const createCompany = vi.fn();
    const existing = {
      id: "deal-1",
      org_id: "org-1",
      company_id: "company-1",
      pipeline_id: "pipeline-1",
      stage_id: "stage-1",
      assigned_to: "user-1",
      title: "모아상사 업무",
      amount: null,
      status_note: null,
      applied_on: null,
      custom: { _first_lead_request_id: requestId },
      created_at: "2026-07-23T00:00:00Z",
      updated_at: "2026-07-23T00:00:00Z",
    } satisfies Deal;
    await expect(
      createLocalFirstLead(
        localSource({
          listDeals: async () => [existing],
          createCompany,
        }),
        ctx,
        { requestId, companyName: "모아상사" },
      ),
    ).resolves.toMatchObject({ created: false, dealId: "deal-1" });
    expect(createCompany).not.toHaveBeenCalled();

    await expect(
      createLocalFirstLead(
        localSource({
          listDeals: async () => [{ ...existing, company_id: null }],
          createCompany,
        }),
        ctx,
        { requestId, companyName: "모아상사" },
      ),
    ).rejects.toThrow("불완전");
    expect(createCompany).not.toHaveBeenCalled();
  });
});

const migration = readFileSync(
  new URL("../../../../supabase/migrations/007_first_lead.sql", import.meta.url),
  "utf8",
).toLowerCase();

describe("007 first lead migration contract", () => {
  it("authenticated 조직 member만 SECURITY DEFINER RPC를 실행한다", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("v_user_id uuid := auth.uid()");
    expect(migration).toContain("from public.org_members member");
    expect(migration).toContain("member.org_id = p_org_id");
    expect(migration).toContain("member.user_id = v_user_id");
    expect(migration).toContain(
      "grant execute on function public.create_first_lead(uuid, uuid, text, text) to authenticated",
    );
  });

  it("기본 pipeline의 marketing stage를 요구한다", () => {
    expect(migration).toContain("pipeline.name = '기본 파이프라인'");
    expect(migration).toContain(
      "stage.kind = 'marketing'::public.stage_kind",
    );
    expect(migration).toContain("raise exception 'marketing stage required'");
  });

  it("조직+request lock과 기존 결과 조회로 멱등 처리한다", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain(
      "p_org_id::text || ':' || p_request_id::text",
    );
    expect(migration).toContain(
      "deal.custom ->> '_first_lead_request_id' = p_request_id::text",
    );
    expect(migration).toContain("'created', false");
    expect(migration).toContain("if v_deal_id is not null then");
    expect(migration).toContain("if v_company_id is null then");
    expect(migration).toContain(
      "raise exception 'existing first lead result is incomplete'",
    );
  });

  it("company와 deal을 한 함수 안에서 만들고 org·assignee를 서버 값으로 고정한다", () => {
    expect(migration).toContain("insert into public.companies");
    expect(migration).toContain("insert into public.deals");
    expect(migration.match(/p_org_id,/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration.match(/v_user_id/g)?.length).toBeGreaterThanOrEqual(4);
    expect(migration).not.toContain("p_assigned_to");
  });
});
