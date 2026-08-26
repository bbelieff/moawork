import type { SupabaseClient } from "@supabase/supabase-js";
import { summarizeDealLedger } from "@/lib/accounting";
import { loadDealLedger } from "@/lib/accounting/server";
import { AsyncCrmService } from "@/lib/crm/asyncService";
import { SupabaseCrmSource } from "@/lib/repo/supabase/supabaseCrmSource";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { loadDefaultTabAssignees } from "@/lib/boards/default-tab-assignees";
import { SupabaseBoardsRepo } from "@/lib/repo/supabase/boardsRepo";
import { CONTRACT_WORK_TAB_SOURCE } from "@/lib/default-tabs/contract-work";
import { summarizeDealMoney, type DealMoneyView } from "@/lib/companies/status";
import type { DealLedgerEntry } from "@/lib/accounting/ledger";
import type { Company, Ctx, Deal } from "@/lib/types";

export type CompanyDealView = Readonly<{
  deal: Deal;
  ledger:
    | Readonly<{ status: "ready"; total: number; received: number; outstanding: number; fee: number }>
    | Readonly<{ status: "error" }>;
  /**
   * #531 「업체관리 현황」 표 한 줄이 쓰는 원장 상세(계약금·수수료·수납일).
   * 원장을 못 읽었으면 **null** 이다 — 0원으로 위장하지 않는다.
   */
  money: DealMoneyView | null;
  /** 담당자 표시 이름. id 만 있으면 화면에 UUID 가 노출된다. 못 찾으면 null. */
  ownerName: string | null;
  /** 진행 상태(스테이지 이름). 스테이지 목록을 못 읽었으면 null. */
  statusLabel: string | null;
  /** #531 — 계약업체 실무 보드에서 읽어 온 진행기관·승인일. 못 읽었으면 둘 다 null. */
  boardFacts: DealBoardFacts;
}>;

export type CompanyView = Readonly<{
  company: Company;
  deals: readonly CompanyDealView[];
}>;

export type CompaniesViewModel =
  /** 워크스페이스 DB 미연결. «못 읽었다»(error) 와 다른 사실이라 상태를 갈라 둔다. */
  | Readonly<{ status: "unconfigured" }>
  | Readonly<{ status: "error" }>
  | Readonly<{
      status: "ready";
      companies: readonly CompanyView[];
      dealsStatus: "ready" | "error";
    }>;

export interface CompaniesViewSource {
  loadCompanies(ctx: Ctx): Promise<readonly Company[]>;
  loadDeals(ctx: Ctx): Promise<readonly Deal[]>;
  loadLedger(ctx: Ctx, dealId: string): Promise<Readonly<{
    total: number;
    received: number;
    outstanding: number;
    fee: number;
    /**
     * #531 — 「업체관리 현황」 표는 합계가 아니라 **건별** 계약금·수수료·수납일을 그린다.
     * 합계만 넘기면 그 다섯 칸을 채울 방법이 없어서 entry 원본을 같이 돌려준다.
     * 합계는 이미 위 네 값이 들고 있으므로 화면이 다시 더하지 않는다.
     */
    entries: readonly DealLedgerEntry[];
  }>>;
  /**
   * 담당자 id → 표시 이름. **선택 사항**이다 —
   * 없으면 담당자 칸이 «미지정» 이 될 뿐 화면은 그대로 선다.
   * 이름 조회가 표 전체를 무너뜨리면 안 되므로 실패도 여기서 삼킨다(호출부 참조).
   */
  loadOwnerNames?(ctx: Ctx): Promise<ReadonlyMap<string, string>>;
  /** 스테이지 id → 이름. 위와 같은 이유로 선택 사항이다. */
  loadStageNames?(ctx: Ctx): Promise<ReadonlyMap<string, string>>;
  /**
   * #531 — 딜 id → 계약업체 실무 보드에 적힌 «진행기관»·«승인일».
   *
   * ★ 왜 여기서 «복사» 하지 않고 읽어 오는가
   *   진행기관은 이미 계약업체 실무 보드의 컬럼(`institution`)이다. 같은 값을 `deals` 에도
   *   두면 두 곳이 서로 어긋나기 시작한다 — 이 저장소가 «수수료(%) vs 계약조건» 으로
   *   이미 한 번 겪은 일이다(#544). 그래서 원본을 그대로 읽는다.
   *   이름표들과 마찬가지로 **선택 사항**이다 — 못 읽으면 그 두 칸만 빈다.
   */
  loadBoardFacts?(ctx: Ctx): Promise<ReadonlyMap<string, DealBoardFacts>>;
}

/** 계약업체 실무 보드가 갖고 있는, 업체관리 현황 표가 쓰는 값. */
export type DealBoardFacts = Readonly<{
  institution: string | null;
  approvedOn: string | null;
}>;

async function createCompaniesViewSource(
  clientFactory: () => Promise<SupabaseClient>,
): Promise<CompaniesViewSource> {
  const client = await clientFactory();
  const crm = new AsyncCrmService(new SupabaseCrmSource(client));
  return {
    loadCompanies: (ctx) => crm.listCompanies(ctx),
    loadDeals: (ctx) => crm.listDeals(ctx),
    async loadLedger(_ctx, dealId) {
      const model = await loadDealLedger(dealId, async () => client);
      const summary = summarizeDealLedger(dealId, model.entries);
      return {
        total: summary.ledgerTotal,
        received: summary.receivedTotal,
        outstanding: summary.outstandingTotal,
        fee: summary.feeTotal,
        entries: model.entries,
      };
    },
    async loadOwnerNames(ctx) {
      const members = await loadDefaultTabAssignees(ctx);
      return new Map(members.map((member) => [member.userId, member.displayName]));
    },
    async loadStageNames(ctx) {
      const pipelines = await crm.listPipelines(ctx);
      return new Map(
        pipelines.flatMap((pipeline) => pipeline.stages.map((stage) => [stage.id, stage.name] as const)),
      );
    },
    async loadBoardFacts(ctx) {
      const boards = new SupabaseBoardsRepo(client);
      const board = (await boards.listBoards(ctx)).find((row) => row.source === CONTRACT_WORK_TAB_SOURCE);
      if (!board) return new Map();
      // 딜에 붙은 아이템만 본다 — 딜과 연결되지 않은 줄은 이 표의 행이 아니다.
      const items = (await boards.listItems(ctx, board.id)).filter((item) => item.deal_id);
      if (items.length === 0) return new Map();
      const values = await boards.listValues(ctx, items.map((item) => item.id));
      const byItem = new Map<string, Record<string, unknown>>();
      for (const value of values) {
        const bucket = byItem.get(value.item_id) ?? {};
        bucket[value.column_key] = value.value_jsonb;
        byItem.set(value.item_id, bucket);
      }
      const text = (raw: unknown): string | null => {
        if (typeof raw === "string") return raw.trim() === "" ? null : raw;
        return raw === null || raw === undefined ? null : String(raw);
      };
      return new Map(items.map((item) => [item.deal_id as string, {
        institution: text(byItem.get(item.id)?.institution),
        approvedOn: text(byItem.get(item.id)?.approved_on),
      }]));
    },
  };
}

/**
 * 이름표 하나가 화면 전체를 못 무너뜨리게 한다.
 * 담당자·상태 이름은 **장식**이다 — 못 읽으면 그 칸만 비고, 회사와 금액은 그대로 나온다.
 * (금액은 정반대다. 그쪽은 실패를 0원으로 바꾸지 않고 «못 읽었다» 를 그대로 들고 간다.)
 */
async function labelsOrEmpty(
  load: ((ctx: Ctx) => Promise<ReadonlyMap<string, string>>) | undefined,
  ctx: Ctx,
): Promise<ReadonlyMap<string, string>> {
  if (!load) return new Map();
  try {
    return await load(ctx);
  } catch {
    return new Map();
  }
}

/**
 * 요청에 결속된 Supabase 세션 하나로 회사·딜·원장을 읽는다.
 * RLS가 조직과 담당범위를 제한하며, 어떤 DB 오류도 빈 배열이나 0원으로 바꾸지 않는다.
 */
export async function loadCompaniesView(
  ctx: Ctx,
  options: Readonly<{
    source?: CompaniesViewSource;
    clientFactory?: () => Promise<SupabaseClient>;
  }> = {},
): Promise<CompaniesViewModel> {
  // ★ `createClient()` 는 환경변수가 없으면 throw 한다(lib/supabase/env.ts). 잡지 않으면
  // 이 화면 전체가 500 이 된다 — 로컬 시드 모드에서 실제로 그랬다. 주입된 source 가 있으면
  // 그쪽이 우선이라 테스트·프로덕션 경로는 이 분기를 지나지 않는다.
  if (!options.source && !options.clientFactory && !hasSupabaseEnv()) {
    return { status: "unconfigured" };
  }
  const source = options.source ?? await createCompaniesViewSource(options.clientFactory ?? createClient);
  // 이름표 두 벌은 회사·딜과 «같은 물결» 에서 함께 나간다 — 뒤에 붙이면 왕복이 늘어난다.
  const [companiesResult, dealsResult, ownerNames, stageNames, boardFacts] = await Promise.all([
    Promise.allSettled([source.loadCompanies(ctx)]).then(([r]) => r),
    Promise.allSettled([source.loadDeals(ctx)]).then(([r]) => r),
    labelsOrEmpty(source.loadOwnerNames?.bind(source), ctx),
    labelsOrEmpty(source.loadStageNames?.bind(source), ctx),
    // #531 — 보드에서 읽어 오는 진행기관·승인일. 이름표들과 같은 «실패해도 화면은 선다» 규칙이다.
    (async (): Promise<ReadonlyMap<string, DealBoardFacts>> => {
      if (!source.loadBoardFacts) return new Map();
      try {
        return await source.loadBoardFacts(ctx);
      } catch {
        return new Map();
      }
    })(),
  ]);

  if (companiesResult.status === "rejected") return { status: "error" };
  if (dealsResult.status === "rejected") {
    return {
      status: "ready",
      companies: companiesResult.value.map((company) => ({ company, deals: [] })),
      dealsStatus: "error",
    };
  }

  const dealsByCompany = new Map<string, Deal[]>();
  for (const deal of dealsResult.value) {
    if (!deal.company_id) continue;
    const bucket = dealsByCompany.get(deal.company_id) ?? [];
    bucket.push(deal);
    dealsByCompany.set(deal.company_id, bucket);
  }

  const companies = await Promise.all(
    companiesResult.value.map(async (company) => {
      const deals = dealsByCompany.get(company.id) ?? [];
      const views = await Promise.all(
        deals.map(async (deal): Promise<CompanyDealView> => {
          const ownerName = deal.assigned_to ? ownerNames.get(deal.assigned_to) ?? null : null;
          const statusLabel = deal.stage_id ? stageNames.get(deal.stage_id) ?? null : null;
          const facts = boardFacts.get(deal.id) ?? { institution: null, approvedOn: null };
          try {
            const { entries, ...summary } = await source.loadLedger(ctx, deal.id);
            return {
              deal,
              ledger: {
                status: "ready",
                ...summary,
              },
              money: summarizeDealMoney(entries),
              ownerName,
              statusLabel,
              boardFacts: facts,
            };
          } catch {
            return { deal, ledger: { status: "error" }, money: null, ownerName, statusLabel, boardFacts: facts };
          }
        }),
      );
      return { company, deals: views };
    }),
  );

  return { status: "ready", companies, dealsStatus: "ready" };
}
