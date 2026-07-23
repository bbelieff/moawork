import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/lib/types";
import type { CrmSource } from "@/lib/repo/supabase/source";

const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_CUSTOM_KEY = "_first_lead_request_id";

export type FirstLeadInput = {
  requestId: string;
  companyName: string;
  dealTitle?: string | null;
};

export type FirstLeadResult = {
  orgId: string;
  companyId: string;
  dealId: string;
  created: boolean;
};

export class FirstLeadError extends Error {
  constructor(
    readonly operation: "input" | "pipeline" | "rpc" | "response" | "local",
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "FirstLeadError";
  }
}

export function normalizeFirstLeadInput(input: FirstLeadInput) {
  const requestId = input.requestId.trim();
  const companyName = input.companyName.trim();
  const requestedTitle = input.dealTitle?.trim() ?? "";

  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new FirstLeadError("input", "요청 식별자가 올바르지 않습니다.");
  }
  if (!companyName) {
    throw new FirstLeadError("input", "업체명을 입력해 주세요.");
  }
  if (companyName.length > 160) {
    throw new FirstLeadError("input", "업체명은 160자 이내로 입력해 주세요.");
  }

  const dealTitle = requestedTitle || `${companyName} 업무`;
  if (dealTitle.length > 200) {
    throw new FirstLeadError("input", "업무명은 200자 이내로 입력해 주세요.");
  }

  return { requestId, companyName, dealTitle };
}

function readResult(data: unknown): FirstLeadResult {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new FirstLeadError("response", "생성 결과를 확인하지 못했습니다.");
  }
  const row = data as Record<string, unknown>;
  if (
    typeof row.org_id !== "string" ||
    typeof row.company_id !== "string" ||
    typeof row.deal_id !== "string" ||
    typeof row.created !== "boolean"
  ) {
    throw new FirstLeadError("response", "생성 결과 형식이 올바르지 않습니다.");
  }
  return {
    orgId: row.org_id,
    companyId: row.company_id,
    dealId: row.deal_id,
    created: row.created,
  };
}

/** 운영 경로: DB 함수 한 번으로 업체+딜을 원자적·멱등 생성한다. */
export async function createFirstLead(
  db: SupabaseClient,
  ctx: Ctx,
  input: FirstLeadInput,
): Promise<FirstLeadResult> {
  const normalized = normalizeFirstLeadInput(input);
  const { data, error } = await db.rpc("create_first_lead", {
    p_org_id: ctx.org.id,
    p_request_id: normalized.requestId,
    p_company_name: normalized.companyName,
    p_deal_title: normalized.dealTitle,
  });

  if (error) {
    throw new FirstLeadError(
      "rpc",
      error.message || "업체와 업무를 저장하지 못했습니다.",
      error.code,
    );
  }

  const result = readResult(data);
  if (result.orgId !== ctx.org.id) {
    throw new FirstLeadError("response", "생성 결과의 조직이 일치하지 않습니다.");
  }
  return result;
}

/**
 * Supabase가 없는 로컬 개발 폴백.
 *
 * 운영 원자성은 create_first_lead RPC가 보장한다. 이 경로는 기존 cached Local source를
 * 유지하면서 같은 폼/조회 흐름을 개발할 수 있게 하고, request UUID 재전송도 재사용한다.
 */
export async function createLocalFirstLead(
  source: CrmSource,
  ctx: Ctx,
  input: FirstLeadInput,
): Promise<FirstLeadResult> {
  const normalized = normalizeFirstLeadInput(input);
  const existing = (await source.listDeals(ctx)).find(
    (deal) => deal.custom[REQUEST_CUSTOM_KEY] === normalized.requestId,
  );
  if (existing) {
    if (!existing.company_id) {
      throw new FirstLeadError("local", "기존 생성 결과가 불완전합니다.");
    }
    return {
      orgId: ctx.org.id,
      companyId: existing.company_id,
      dealId: existing.id,
      created: false,
    };
  }

  const pipeline = (await source.listPipelines(ctx.org.id)).find(
    (candidate) => candidate.name === "기본 파이프라인",
  );
  if (!pipeline) {
    throw new FirstLeadError("pipeline", "기본 파이프라인이 없습니다.");
  }
  const stage = (await source.listStages(pipeline.id)).find(
    (candidate) => candidate.kind === "marketing",
  );
  if (!stage) {
    throw new FirstLeadError("pipeline", "마케팅 단계가 없습니다.");
  }

  const company = await source.createCompany(ctx, {
    name: normalized.companyName,
    assigned_to: ctx.user.id,
  });
  const deal = await source.createDeal(ctx, {
    title: normalized.dealTitle,
    company_id: company.id,
    pipeline_id: pipeline.id,
    stage_id: stage.id,
    assigned_to: ctx.user.id,
    custom: { [REQUEST_CUSTOM_KEY]: normalized.requestId },
  });

  return {
    orgId: ctx.org.id,
    companyId: company.id,
    dealId: deal.id,
    created: true,
  };
}
