import { describe, expect, it } from "vitest";
import type { Company, Ctx, Deal, Stage } from "@/lib/types";
import type { NewCompany } from "@/lib/repo";
import {
  CONTACT_MOVE_LABEL,
  ContactPipelineError,
  moveContactPipeline,
  rollbackContactPipeline,
  type ContactPipelineSource,
} from "./contactPipeline";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const PIPELINE = "00000000-0000-4000-8000-000000000010";
const MARKETING = "00000000-0000-4000-8000-000000000011";
const MEETING = "00000000-0000-4000-8000-000000000012";
const WORK = "00000000-0000-4000-8000-000000000013";
const DEAL = "00000000-0000-4000-8000-000000000020";
const REQUEST = "00000000-0000-4000-8000-000000000030";
const REQUEST_2 = "00000000-0000-4000-8000-000000000031";

const ctx: Ctx = {
  user: { id: "user-1", email: null, name: "담당자", avatar_url: null, created_at: "2026-01-01" },
  org: { id: ORG, name: "테스트 회사", plan_tier: "trial", created_at: "2026-01-01" },
  role: "owner",
  scope: "all",
};

const stages: Stage[] = [
  { id: MARKETING, pipeline_id: PIPELINE, name: "신규리드", sort_order: 1, kind: "marketing" },
  { id: MEETING, pipeline_id: PIPELINE, name: "컨택업체", sort_order: 2, kind: "meeting" },
  { id: WORK, pipeline_id: PIPELINE, name: "업무관리", sort_order: 3, kind: "work" },
];

function makeDeal(patch: Partial<Deal> = {}): Deal {
  return {
    id: DEAL,
    org_id: ORG,
    company_id: null,
    pipeline_id: PIPELINE,
    stage_id: MARKETING,
    assigned_to: "user-1",
    title: "샘플 업체",
    amount: null,
    status_note: null,
    fee_terms: null,
    applied_on: "2026-08-01",
    custom: {
      ad_name: "검색 광고",
      phone: "000-0000-0000",
      owner_name: "샘플 대표",
      revenue: 120000,
      email: "sample@example.invalid",
    },
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...patch,
  };
}

class MemorySource implements ContactPipelineSource {
  deal: Deal;
  companies = new Map<string, Company>();
  writes: string[] = [];
  activities: string[] = [];
  pipelineStages = stages;
  failMove = false;
  requests = new Map<string, {
    dealId: string;
    kind: "lead_to_contact" | "contact_to_work";
    status: "in_progress" | "committed" | "rejected" | "failed" | "rolled_back" | "repair_required";
    errorCode: ContactPipelineError["code"] | null;
  }>();
  activeDeals = new Map<string, string>();
  failRollbackAt: "link" | "delete" | null = null;

  constructor(deal = makeDeal()) {
    this.deal = structuredClone(deal);
  }

  async listPipelines() {
    return [{ id: PIPELINE, stages: this.pipelineStages }];
  }

  async getDeal(_ctx: Ctx, id: string) {
    if (id !== this.deal.id) throw new Error("not found");
    return structuredClone(this.deal);
  }

  async getCompany(_ctx: Ctx, id: string) {
    const company = this.companies.get(id);
    if (!company) throw new Error("not found");
    return structuredClone(company);
  }

  async createCompany(_ctx: Ctx, input: NewCompany) {
    const company: Company = {
      id: `company-${this.companies.size + 1}`,
      org_id: ORG,
      name: input.name,
      biz_type: input.biz_type ?? null,
      region: input.region ?? null,
      owner_name: input.owner_name ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      revenue: input.revenue ?? null,
      founded_on: input.founded_on ?? null,
      homepage: input.homepage ?? null,
      assigned_to: input.assigned_to ?? null,
      created_at: "2026-08-10T00:00:00Z",
    };
    this.companies.set(company.id, company);
    this.writes.push(`create-company:${company.id}`);
    return structuredClone(company);
  }

  async deleteCompany(_ctx: Ctx, id: string) {
    this.companies.delete(id);
    this.writes.push(`delete-company:${id}`);
  }

  async updateDeal(_ctx: Ctx, id: string, patch: { company_id?: string | null; custom?: Record<string, unknown> }) {
    if (id !== this.deal.id) throw new Error("not found");
    const custom = { ...this.deal.custom };
    for (const [key, value] of Object.entries(patch.custom ?? {})) {
      if (value === null) delete custom[key];
      else custom[key] = structuredClone(value);
    }
    this.deal = {
      ...this.deal,
      company_id: patch.company_id === undefined ? this.deal.company_id : patch.company_id,
      custom,
    };
    this.writes.push("update-deal");
    return structuredClone(this.deal);
  }

  async moveDealStage(_ctx: Ctx, id: string, toStageId: string) {
    if (this.failMove) throw new Error("move failed");
    if (id !== this.deal.id) throw new Error("not found");
    this.deal = { ...this.deal, stage_id: toStageId };
    this.writes.push(`move:${toStageId}`);
    return structuredClone(this.deal);
  }

  async createActivity(_ctx: Ctx, _dealId: string, input: { type: string; content: string | null }) {
    this.activities.push(`${input.type}:${input.content ?? ""}`);
    this.writes.push("activity");
    return {};
  }

  async beginContactPipelineRequest(
    _ctx: Ctx,
    input: { requestId: string; dealId: string; kind: "lead_to_contact" | "contact_to_work" },
  ) {
    const existing = this.requests.get(input.requestId);
    if (existing) {
      if (existing.dealId !== input.dealId || existing.kind !== input.kind) {
        throw new ContactPipelineError("conflict", "request mismatch");
      }
      if (existing.status === "in_progress") return { state: "busy" } as const;
      return { state: "replay", status: existing.status, errorCode: existing.errorCode } as const;
    }
    if (this.activeDeals.has(input.dealId)) return { state: "busy" } as const;
    this.requests.set(input.requestId, { ...input, status: "in_progress", errorCode: null });
    this.activeDeals.set(input.dealId, input.requestId);
    this.writes.push("reserve-request");
    return { state: "acquired" } as const;
  }

  async finishContactPipelineRequest(
    _ctx: Ctx,
    input: {
      requestId: string;
      dealId: string;
      kind: "lead_to_contact" | "contact_to_work";
      status: "committed" | "rejected" | "failed" | "rolled_back" | "repair_required";
      errorCode: ContactPipelineError["code"] | null;
    },
  ) {
    const existing = this.requests.get(input.requestId);
    if (!existing || existing.dealId !== input.dealId || existing.kind !== input.kind) {
      throw new Error("request mismatch");
    }
    this.requests.set(input.requestId, { ...input });
    this.activeDeals.delete(input.dealId);
    this.writes.push(`finish:${input.status}`);
  }

  async rollbackContactPipelineTransition(
    _ctx: Ctx,
    input: {
      requestId: string;
      dealId: string;
      marker: {
        kind: "lead_to_contact" | "contact_to_work";
        fromStageId: string;
        previousCompanyId: string | null;
        companyId: string | null;
        companyCreated: boolean;
      };
    },
  ) {
    const existing = this.requests.get(input.requestId);
    if (!existing || existing.dealId !== input.dealId) throw new Error("request mismatch");
    if (existing.status === "rolled_back") {
      return { state: "replay", deal: structuredClone(this.deal) } as const;
    }
    if (existing.status === "repair_required") {
      return { state: "repair_required", deal: structuredClone(this.deal) } as const;
    }
    if (existing.status !== "committed") throw new Error("request is not committed");

    // 실제 구현은 아래 변경 전체를 한 DB transaction에서 수행한다. 이 fake는 commit 시점만 반영한다.
    if (this.failRollbackAt) {
      this.requests.set(input.requestId, { ...existing, status: "repair_required", errorCode: "rollback_failed" });
      this.activeDeals.delete(input.dealId);
      this.writes.push("finish:repair_required");
      return { state: "repair_required", deal: structuredClone(this.deal) } as const;
    }

    const custom = {
      ...this.deal.custom,
      contact_pipeline_transition: {
        ...(this.deal.custom.contact_pipeline_transition as Record<string, unknown>),
        status: "rolled_back",
      },
    };
    this.deal = {
      ...this.deal,
      stage_id: input.marker.fromStageId,
      company_id: input.marker.previousCompanyId,
      custom,
    };
    if (input.marker.companyCreated && input.marker.companyId) {
      this.companies.delete(input.marker.companyId);
    }
    this.requests.set(input.requestId, { ...existing, status: "rolled_back", errorCode: null });
    this.activeDeals.delete(input.dealId);
    this.writes.push("atomic-rollback");
    return { state: "rolled_back", deal: structuredClone(this.deal) } as const;
  }
}

describe("contact pipeline contract", () => {
  it("D68은 신규리드 관문을 컨택 이동 하나로 고정한다", () => {
    expect(CONTACT_MOVE_LABEL).toBe("컨택 이동");
    expect(CONTACT_MOVE_LABEL).not.toContain("처리");
  });

  it("같은 딜을 컨택 단계로 옮기고 7개 기본정보를 그대로 보존한다", async () => {
    const source = new MemorySource();
    const before = structuredClone(source.deal);
    const result = await moveContactPipeline(source, ctx, {
      dealId: DEAL,
      kind: "lead_to_contact",
      requestId: REQUEST,
    });

    expect(result.deal.id).toBe(before.id);
    expect(result.deal.stage_id).toBe(MEETING);
    expect(result.deal.applied_on).toBe(before.applied_on);
    expect(result.deal.assigned_to).toBe(before.assigned_to);
    expect(result.deal.custom).toMatchObject({
      ad_name: before.custom.ad_name,
      phone: before.custom.phone,
      owner_name: before.custom.owner_name,
      revenue: before.custom.revenue,
      email: before.custom.email,
    });
  });

  it("동일 요청 재전송은 실제 쓰기를 한 건도 만들지 않는다", async () => {
    const source = new MemorySource();
    await moveContactPipeline(source, ctx, { dealId: DEAL, kind: "lead_to_contact", requestId: REQUEST });
    const writes = source.writes.length;
    const replay = await moveContactPipeline(source, ctx, { dealId: DEAL, kind: "lead_to_contact", requestId: REQUEST });
    expect(replay.replayed).toBe(true);
    expect(source.writes).toHaveLength(writes);
  });

  it("잘못된 요청과 단계 중복은 고객 데이터를 바꾸지 않고 닫는다", async () => {
    const malformed = new MemorySource();
    await expect(moveContactPipeline(malformed, ctx, { dealId: DEAL, kind: "lead_to_contact", requestId: "bad" }))
      .rejects.toMatchObject({ code: "invalid_request" });
    expect(malformed.writes).toHaveLength(0);

    const ambiguous = new MemorySource();
    ambiguous.pipelineStages = [...stages, { ...stages[1], id: "meeting-duplicate" }];
    await expect(moveContactPipeline(ambiguous, ctx, { dealId: DEAL, kind: "lead_to_contact", requestId: REQUEST }))
      .rejects.toMatchObject({ code: "stage_contract" });
    expect(ambiguous.writes.filter((entry) => entry.startsWith("move:") || entry.startsWith("create-company") || entry === "update-deal")).toHaveLength(0);
  });

  it("다른 회사의 건은 존재를 활용하지 않고 거부한다", async () => {
    const source = new MemorySource(makeDeal({ org_id: OTHER_ORG }));
    await expect(moveContactPipeline(source, ctx, { dealId: DEAL, kind: "lead_to_contact", requestId: REQUEST }))
      .rejects.toMatchObject({ code: "not_allowed" });
    expect(source.writes).toHaveLength(0);
  });

  it("직인 승인 전에는 업체와 단계를 바꾸지 않고 동일 요청 재전송도 0-write다", async () => {
    const source = new MemorySource(makeDeal({ stage_id: MEETING }));
    await expect(moveContactPipeline(source, ctx, { dealId: DEAL, kind: "contact_to_work", requestId: REQUEST }))
      .rejects.toMatchObject({ code: "seal_required" });
    expect(source.deal.stage_id).toBe(MEETING);
    expect(source.deal.company_id).toBeNull();
    expect(source.companies).toHaveLength(0);
    expect(source.activities).toEqual([]);
    const writes = source.writes.length;
    await expect(moveContactPipeline(source, ctx, { dealId: DEAL, kind: "contact_to_work", requestId: REQUEST }))
      .rejects.toMatchObject({ code: "seal_required" });
    expect(source.writes).toHaveLength(writes);
  });

  it("직인 승인 후 업체 마스터를 생성·연결하고 업무로 이동한다", async () => {
    const source = new MemorySource(makeDeal({
      stage_id: MEETING,
      custom: { ...makeDeal().custom, seal_approval: "완료" },
    }));
    const result = await moveContactPipeline(source, ctx, {
      dealId: DEAL,
      kind: "contact_to_work",
      requestId: REQUEST,
    });
    expect(result.deal.stage_id).toBe(WORK);
    expect(result.deal.company_id).toBe("company-1");
    expect(source.companies.get("company-1")).toMatchObject({
      name: "샘플 업체",
      org_id: ORG,
      assigned_to: "user-1",
    });
  });

  it("기존 업체 연결은 이름으로 재탐색하거나 덮어쓰지 않고 그대로 재사용한다", async () => {
    const company: Company = {
      id: "company-existing",
      org_id: ORG,
      name: "기존 정본 업체",
      biz_type: null,
      region: null,
      owner_name: null,
      phone: null,
      email: null,
      revenue: null,
      founded_on: null,
      homepage: null,
      assigned_to: null,
      created_at: "2026-01-01",
    };
    const source = new MemorySource(makeDeal({
      stage_id: MEETING,
      company_id: company.id,
      custom: { seal_approval: "완료" },
    }));
    source.companies.set(company.id, company);
    await moveContactPipeline(source, ctx, { dealId: DEAL, kind: "contact_to_work", requestId: REQUEST });
    expect(source.companies.get(company.id)).toEqual(company);
    expect(source.writes.some((entry) => entry.startsWith("create-company"))).toBe(false);
  });

  it("이동 실패는 새 업체 연결과 생성을 보상 복구하고 성공을 반환하지 않는다", async () => {
    const source = new MemorySource(makeDeal({
      stage_id: MEETING,
      custom: { seal_approval: "완료" },
    }));
    source.failMove = true;
    await expect(moveContactPipeline(source, ctx, { dealId: DEAL, kind: "contact_to_work", requestId: REQUEST }))
      .rejects.toThrow("move failed");
    expect(source.deal.stage_id).toBe(MEETING);
    expect(source.deal.company_id).toBeNull();
    expect(source.companies).toHaveLength(0);
  });

  it("동시 동일 요청은 원자 예약으로 업체를 한 번만 생성한다", async () => {
    const source = new MemorySource(makeDeal({
      stage_id: MEETING,
      custom: { seal_approval: "완료" },
    }));
    const results = await Promise.allSettled([
      moveContactPipeline(source, ctx, { dealId: DEAL, kind: "contact_to_work", requestId: REQUEST }),
      moveContactPipeline(source, ctx, { dealId: DEAL, kind: "contact_to_work", requestId: REQUEST }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(source.writes.filter((entry) => entry.startsWith("create-company"))).toHaveLength(1);
    expect(source.companies).toHaveLength(1);
  });

  it("빈 업체명은 placeholder 업체를 만들지 않고 닫는다", async () => {
    const source = new MemorySource(makeDeal({
      title: "   ",
      stage_id: MEETING,
      custom: { seal_approval: "완료" },
    }));
    await expect(moveContactPipeline(source, ctx, { dealId: DEAL, kind: "contact_to_work", requestId: REQUEST }))
      .rejects.toMatchObject({ code: "invalid_request" });
    expect(source.companies).toHaveLength(0);
    expect(source.deal.stage_id).toBe(MEETING);
  });

  it("승인된 이동을 정확히 되돌리고 롤백 재전송은 0-write다", async () => {
    const source = new MemorySource(makeDeal({
      stage_id: MEETING,
      custom: { seal_approval: "완료" },
    }));
    await moveContactPipeline(source, ctx, { dealId: DEAL, kind: "contact_to_work", requestId: REQUEST_2 });
    const rolledBack = await rollbackContactPipeline(source, ctx, { dealId: DEAL, requestId: REQUEST_2 });
    expect(rolledBack.deal.stage_id).toBe(MEETING);
    expect(rolledBack.deal.company_id).toBeNull();
    expect(source.companies).toHaveLength(0);
    const writes = source.writes.length;
    const replay = await rollbackContactPipeline(source, ctx, { dealId: DEAL, requestId: REQUEST_2 });
    expect(replay.replayed).toBe(true);
    expect(source.writes).toHaveLength(writes);
  });

  it.each(["link", "delete"] as const)(
    "롤백 %s 실패는 committed 데이터를 보존하고 repair_required로 종결한다",
    async (failurePoint) => {
      const source = new MemorySource(makeDeal({
        stage_id: MEETING,
        custom: { seal_approval: "완료" },
      }));
      await moveContactPipeline(source, ctx, { dealId: DEAL, kind: "contact_to_work", requestId: REQUEST });
      const committed = structuredClone(source.deal);
      const companyIds = [...source.companies.keys()];
      source.failRollbackAt = failurePoint;

      await expect(rollbackContactPipeline(source, ctx, { dealId: DEAL, requestId: REQUEST }))
        .rejects.toMatchObject({ code: "rollback_failed" });
      expect(source.deal).toEqual(committed);
      expect([...source.companies.keys()]).toEqual(companyIds);
      expect(source.requests.get(REQUEST)?.status).toBe("repair_required");
      expect(source.activeDeals.has(DEAL)).toBe(false);

      const writes = source.writes.length;
      await expect(rollbackContactPipeline(source, ctx, { dealId: DEAL, requestId: REQUEST }))
        .rejects.toMatchObject({ code: "rollback_failed" });
      expect(source.writes).toHaveLength(writes);
      expect(source.deal).toEqual(committed);
    },
  );

  it("다른 요청 ID로 기존 이동을 덮어쓰지 않는다", async () => {
    const source = new MemorySource();
    await moveContactPipeline(source, ctx, { dealId: DEAL, kind: "lead_to_contact", requestId: REQUEST });
    await expect(moveContactPipeline(source, ctx, { dealId: DEAL, kind: "lead_to_contact", requestId: REQUEST_2 }))
      .rejects.toBeInstanceOf(ContactPipelineError);
  });
});
