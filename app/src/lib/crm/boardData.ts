import type { Company, Ctx, Deal, Stage } from "@/lib/types";
import { getCrmSource, type CrmSource } from "@/lib/repo/supabase";
import {
  dealsForBoard,
  groupByStage,
  stagesForBoard,
  type StageBoardDef,
} from "./stageBoards";

export interface StageBoardData {
  board: StageBoardDef;
  /** 이 보드에 속한 단계(칸반 컬럼). 파이프라인 미구성이면 빈 배열. */
  columns: Array<{ stage: Stage; deals: Deal[] }>;
  total: number;
  /** 딜의 company_id → 고객사. 목록에서 업체명을 보여주려고 미리 만든다(N+1 방지). */
  companyById: Map<string, Company>;
  /** 데이터 출처 — 화면에 로컬/Supabase 배지를 띄운다. */
  sourceKind: CrmSource["kind"];
}

/**
 * 단계 보드 1개를 그리는 데 필요한 데이터를 모은다 (T02 · B2).
 *
 * 담당범위(scope)는 소스가 적용한다 — 여기서 다시 거르지 않는다(이중 적용 방지).
 * 조직에 파이프라인이 여러 개면 전 파이프라인의 같은 kind 단계를 한 보드에 모은다.
 */
export async function loadStageBoard(
  ctx: Ctx,
  board: StageBoardDef,
  source: CrmSource = getCrmSource(),
): Promise<StageBoardData> {
  const pipelines = await source.listPipelines(ctx.org.id);

  const stageLists = await Promise.all(
    pipelines.map((p) => source.listStages(p.id)),
  );
  const boardStages = stagesForBoard(stageLists.flat(), board.kind);

  const allDeals = await source.listDeals(ctx);
  const deals = dealsForBoard(allDeals, boardStages);

  const companyById = new Map<string, Company>();
  if (deals.length > 0) {
    for (const c of await source.listCompanies(ctx)) companyById.set(c.id, c);
  }

  return {
    board,
    columns: groupByStage(deals, boardStages),
    total: deals.length,
    companyById,
    sourceKind: source.kind,
  };
}
