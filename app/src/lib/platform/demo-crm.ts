import type { StageBoardData } from "@/lib/crm/boardData";
import type { StageBoardDef } from "@/lib/crm/stageBoards";
import type { Company, Deal, Stage } from "@/lib/types";

type DemoCrmPayload = Readonly<{ stages: Stage[]; deals: Deal[]; companies: Company[] }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function resolvePlatformDemoCrm(value: unknown): DemoCrmPayload | null {
  if (!isRecord(value) || !Array.isArray(value.stages) || !Array.isArray(value.deals) || !Array.isArray(value.companies)) return null;
  const stages = value.stages.filter((stage): stage is Stage => isRecord(stage)
    && typeof stage.id === "string" && typeof stage.pipeline_id === "string"
    && typeof stage.name === "string" && typeof stage.sort_order === "number" && typeof stage.kind === "string");
  const deals = value.deals.filter((deal): deal is Deal => isRecord(deal)
    && typeof deal.id === "string" && typeof deal.org_id === "string" && typeof deal.title === "string"
    && isRecord(deal.custom) && typeof deal.created_at === "string" && typeof deal.updated_at === "string");
  const companies = value.companies.filter((company): company is Company => isRecord(company)
    && typeof company.id === "string" && typeof company.org_id === "string"
    && typeof company.name === "string" && typeof company.created_at === "string");
  if (stages.length !== value.stages.length || deals.length !== value.deals.length || companies.length !== value.companies.length) return null;
  return { stages, deals, companies };
}

export function toPlatformDemoStageBoard(board: StageBoardDef, payload: DemoCrmPayload): StageBoardData {
  const companyById = new Map(payload.companies.map((company) => [company.id, company]));
  const columns = payload.stages.slice().sort((a, b) => a.sort_order - b.sort_order)
    .map((stage) => ({ stage, deals: payload.deals.filter((deal) => deal.stage_id === stage.id) }));
  return { board, columns, total: payload.deals.length, companyById, sourceKind: "supabase" };
}
