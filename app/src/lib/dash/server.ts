import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx, FieldDef, FieldOption, Settlement } from "@/lib/types";
import type { Notice } from "@/lib/notices/types";
import { AsyncCrmService, type PipelineWithStages } from "@/lib/crm/asyncService";
import { BoardsService } from "@/lib/boards/service";
import { NoticesService } from "@/lib/notices/service";
import { loadDealLedger } from "@/lib/accounting/server";
import { SupabaseBoardsRepo } from "@/lib/repo/supabase/boardsRepo";
import { SupabaseCrmSource } from "@/lib/repo/supabase/supabaseCrmSource";
import { getRepo } from "@/lib/repo";
import { createClient } from "@/lib/supabase/server";
import { canUseLocalSeedFallback } from "@/lib/supabase/local-fallback";
import {
  buildDashboardFromInputs,
  buildFollowUpsFromDeals,
  type DashboardData,
  type DashboardFollowUps,
} from "./service";

type Row = Record<string, unknown>;
type Deal = Awaited<ReturnType<AsyncCrmService["listDeals"]>>[number];
type Company = Awaited<ReturnType<AsyncCrmService["listCompanies"]>>[number];

export type DashboardSegment<T> =
  | Readonly<{ status: "ready"; data: T }>
  | Readonly<{ status: "unavailable"; operation: string }>;

export type DashboardCoreData = Readonly<{
  dash: DashboardData;
  followUps: DashboardFollowUps;
  pipelines: readonly PipelineWithStages[];
  stages: readonly PipelineWithStages["stages"][number][];
  deals: readonly Deal[];
}>;

export type DashboardBoardsData = Readonly<{
  boardCount: number;
  itemCount: number;
}>;

export type DashboardLedgerData = Readonly<{
  entryCount: number;
  expectedFeeTotal: number;
}>;

export type DashboardPageData = Readonly<{
  core: DashboardSegment<DashboardCoreData>;
  boards: DashboardSegment<DashboardBoardsData>;
  notices: DashboardSegment<readonly Notice[]>;
  ledger: DashboardSegment<DashboardLedgerData>;
}>;

type CrmInputs = Readonly<{
  deals: readonly Deal[];
  companies: readonly Company[];
  pipelines: readonly PipelineWithStages[];
  stages: readonly PipelineWithStages["stages"][number][];
}>;

type DashboardInputs = Readonly<{
  fieldDefs: readonly FieldDef[];
  settlements: readonly Settlement[];
}>;

/**
 * One request's dashboard readers. Production constructs this once from the
 * cookie-bound Supabase server client. Tests/dev fixtures may inject this
 * contract explicitly.
 *
 * 폴백 규칙(BBE-203): 주입이 없고 **Supabase env 도 없을 때만** 로컬 시드 구현을 쓴다.
 * env 가 있으면 언제나 Supabase 다 — 암묵 폴백은 여전히 없다. 갈림길은 env 하나뿐이다.
 */
export interface DashboardSource {
  loadCrm(ctx: Ctx): Promise<CrmInputs>;
  loadDashboardInputs(ctx: Ctx, visibleDealIds: ReadonlySet<string>): Promise<DashboardInputs>;
  loadBoards(ctx: Ctx): Promise<DashboardBoardsData>;
  loadNotices(ctx: Ctx): Promise<readonly Notice[]>;
  loadLedger(ctx: Ctx, visibleDealIds: readonly string[]): Promise<DashboardLedgerData>;
}

export class DashboardReadError extends Error {
  constructor(readonly operation: string) {
    super(`dashboard data could not be loaded (${operation})`);
    this.name = "DashboardReadError";
  }
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new DashboardReadError("parse");
  return value;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new DashboardReadError("parse");
  return parsed;
}

function fieldDef(row: Row): FieldDef {
  const options = row.options_jsonb as { options?: unknown } | null;
  return {
    id: text(row.id),
    org_id: text(row.org_id),
    entity: text(row.entity) as FieldDef["entity"],
    key: text(row.key),
    label: text(row.label),
    type: text(row.type) as FieldDef["type"],
    options_jsonb: options && Array.isArray(options.options)
      ? { options: options.options as FieldOption[] }
      : null,
    module_key: nullableText(row.module_key),
    sort_order: numberValue(row.sort_order),
  };
}

function settlement(row: Row): Settlement {
  return {
    id: text(row.id),
    org_id: text(row.org_id),
    deal_id: nullableText(row.deal_id),
    down_payment: numberValue(row.down_payment),
    down_paid_at: nullableText(row.down_paid_at),
    exec_amount: numberValue(row.exec_amount),
    fee_pct: numberValue(row.fee_pct),
    fee_paid_at: nullableText(row.fee_paid_at),
    fee_amount: numberValue(row.fee_amount),
    total_revenue: numberValue(row.total_revenue),
    d180: nullableText(row.d180),
    d365: nullableText(row.d365),
    created_at: text(row.created_at),
  };
}

function createSupabaseDashboardSource(client: SupabaseClient): DashboardSource {
  const crm = new AsyncCrmService(new SupabaseCrmSource(client));
  const boardsRepo = new SupabaseBoardsRepo(client);
  const boards = new BoardsService(boardsRepo);
  const notices = new NoticesService(boards, boardsRepo);

  return {
    async loadCrm(ctx) {
      const [deals, companies, pipelines] = await Promise.all([
        crm.listDeals(ctx),
        crm.listCompanies(ctx),
        crm.listPipelines(ctx),
      ]);
      return {
        deals,
        companies,
        pipelines,
        stages: pipelines.flatMap((pipeline) => pipeline.stages),
      };
    },

    async loadDashboardInputs(ctx, visibleDealIds) {
      const [fieldsResult, settlementsResult] = await Promise.all([
        client
          .from("field_defs")
          .select("id,org_id,entity,key,label,type,options_jsonb,module_key,sort_order")
          .eq("org_id", ctx.org.id)
          .eq("entity", "deal")
          .order("sort_order"),
        client
          .from("settlements")
          .select("id,org_id,deal_id,down_payment,down_paid_at,exec_amount,fee_pct,fee_paid_at,fee_amount,total_revenue,d180,d365,created_at")
          .eq("org_id", ctx.org.id)
          .order("created_at", { ascending: false }),
      ]);
      if (fieldsResult.error || !Array.isArray(fieldsResult.data)) {
        throw new DashboardReadError("field_defs");
      }
      if (settlementsResult.error || !Array.isArray(settlementsResult.data)) {
        throw new DashboardReadError("settlements");
      }
      return {
        fieldDefs: (fieldsResult.data as Row[]).map(fieldDef),
        settlements: (settlementsResult.data as Row[])
          .map(settlement)
          .filter((row) => row.deal_id !== null && visibleDealIds.has(row.deal_id)),
      };
    },

    async loadBoards(ctx) {
      const visibleBoards = await boards.listBoards(ctx);
      const items = await Promise.all(visibleBoards.map((board) => boards.listItems(ctx, board.id)));
      return {
        boardCount: visibleBoards.length,
        itemCount: items.reduce((sum, rows) => sum + rows.length, 0),
      };
    },

    loadNotices(ctx) {
      return notices.list(ctx, { limit: 5 });
    },

    async loadLedger(_ctx, visibleDealIds) {
      const ledgers = await Promise.all(
        visibleDealIds.map((dealId) => loadDealLedger(dealId, async () => client)),
      );
      return {
        entryCount: ledgers.reduce((sum, model) => sum + model.entries.length, 0),
        expectedFeeTotal: ledgers.reduce((sum, model) => sum + model.expectedFeeTotal, 0),
      };
    },
  };
}

/**
 * Supabase 가 없는 로컬 시드 모드용 읽기 구현 (BBE-203).
 *
 * ★ 새로 만드는 게 거의 없다 — 아래 세 공장은 **이미 env 를 보고 로컬로 떨어진다**:
 *     getCrmSource()   → LocalCrmSource      (repo/supabase/index.ts:22)
 *     getBoardsRepo()  → LocalBoardsRepo     (repo/local/boardsRepo.ts:396)
 *     getRepo()        → LocalRepo
 *   `AsyncCrmService`·`BoardsService`·`NoticesService` 는 인자를 안 주면 그 공장을 쓴다.
 *   이 파일만 `new SupabaseCrmSource(client)` 로 **그 배선을 건너뛰고 있었다** — 그래서
 *   로컬에서 홈·업무분석이 통째로 500 이 났다. 여기서는 기본 생성자를 그대로 쓴다.
 *
 * 원장(ledger)만 로컬 구현이 없다. 조용히 0 으로 채우지 않고 던져서
 * `capture()` 가 «조회 불가» 로 표시하게 둔다 — 없는 숫자를 있는 척하지 않는다.
 */
function createLocalDashboardSource(): DashboardSource {
  const crm = new AsyncCrmService();
  const boards = new BoardsService();
  const notices = new NoticesService(boards);

  return {
    async loadCrm(ctx) {
      const [deals, companies, pipelines] = await Promise.all([
        crm.listDeals(ctx),
        crm.listCompanies(ctx),
        crm.listPipelines(ctx),
      ]);
      return {
        deals,
        companies,
        pipelines,
        stages: pipelines.flatMap((pipeline) => pipeline.stages),
      };
    },

    async loadDashboardInputs(ctx, visibleDealIds) {
      // ★ 인메모리 저장소는 «운영 빌드에서 도달할 수 없는 자리» 에서만 만진다.
      //   조건을 여기 그대로 적는 이유: 경계 검사기(scripts/check-production-repo-boundaries.mjs)가
      //   이 형태의 dev 가드를 읽고 «운영 호출 그래프가 아니다» 로 판정한다.
      //   함수로 감싸면 검사기가 못 읽어 운영 위반으로 세어진다 — 즉 이 문법이 곧 증명이다.
      if (process.env.NODE_ENV !== "production") {
        const repo = getRepo();
        return {
          fieldDefs: repo.listFieldDefs(ctx.org.id, "deal"),
          settlements: repo
            .listSettlements(ctx)
            .filter((row) => row.deal_id !== null && visibleDealIds.has(row.deal_id)),
        };
      }
      // 여기 닿았다는 것은 운영 빌드가 로컬 소스를 골랐다는 뜻이다 — 있을 수 없다. 조용히 넘기지 않는다.
      throw new DashboardReadError("dashboard");
    },

    async loadBoards(ctx) {
      const visibleBoards = await boards.listBoards(ctx);
      const items = await Promise.all(visibleBoards.map((board) => boards.listItems(ctx, board.id)));
      return {
        boardCount: visibleBoards.length,
        itemCount: items.reduce((sum, rows) => sum + rows.length, 0),
      };
    },

    loadNotices(ctx) {
      return notices.list(ctx, { limit: 5 });
    },

    async loadLedger() {
      throw new DashboardReadError("ledger");
    },
  };
}

function unavailable<T>(operation: string): DashboardSegment<T> {
  return { status: "unavailable", operation };
}

async function capture<T>(operation: string, read: () => Promise<T>): Promise<DashboardSegment<T>> {
  try {
    return { status: "ready", data: await read() };
  } catch {
    return unavailable(operation);
  }
}

export async function loadDashboardPageData(
  ctx: Ctx,
  options: {
    month?: string;
    now?: () => Date;
    source?: DashboardSource;
    clientFactory?: () => Promise<SupabaseClient>;
  } = {},
): Promise<DashboardPageData> {
  // createClient is cookie-bound. It must run once per page request and that
  // exact client is shared by every adapter below.
  //
  // ★ 폴백은 «암묵» 이 아니라 env 로만 갈린다(BBE-203).
  //   env 가 있으면 예전과 한 글자도 다르지 않게 Supabase 경로를 탄다.
  //   env 가 없을 때만 로컬 시드로 떨어진다 — 예전엔 여기서 createClient() 가 던져
  //   capture() 밖이라 페이지가 통째로 500 이었다(홈·업무분석 촬영 NOT_RUN 의 원인).
  //   명시 주입(source·clientFactory)은 언제나 최우선이다 — 테스트가 env 에 안 끌려간다.
  const source = options.source
    ?? (options.clientFactory
      ? createSupabaseDashboardSource(await options.clientFactory())
      : canUseLocalSeedFallback()
        ? createLocalDashboardSource()
        : createSupabaseDashboardSource(await createClient()));
  // ★ BBE-215 — 물결을 «의존이 허락하는 만큼만» 줄인다.
  //   boards·notices 는 시그니처가 (ctx) 뿐이라 crm 결과를 안 쓴다. 그런데 예전에는
  //   crm → inputs → [boards·notices·ledger] 로 «맨 뒤» 물결에 묶여 있었다.
  //   앞으로 당기면 crm 과 같은 물결에 실린다 — 왕복 수는 그대로고 직렬 단계만 줄어든다.
  //   ledger 는 crm.data.deals 가 «입력» 이라 못 당긴다. 그건 진짜 의존이다.
  const [crm, boardsSegment, noticesSegment] = await Promise.all([
    capture("crm", () => source.loadCrm(ctx)),
    capture("boards", () => source.loadBoards(ctx)),
    capture("notices", () => source.loadNotices(ctx)),
  ]);
  const now = options.now?.() ?? new Date();

  //   ★ core(=inputs) 와 ledger 는 «둘 다» crm.data.deals 만 입력으로 쓴다. 서로는 무관하다.
  //     그러니 crm 뒤의 «한 물결» 에 같이 실어야 한다 — 줄 세우면 단계가 하나 더 는다.
  const [core, ledgerSegment] = await Promise.all([
    crm.status === "unavailable"
    ? Promise.resolve(unavailable<DashboardCoreData>(crm.operation))
    : capture("dashboard", async () => {
        const input = await source.loadDashboardInputs(
          ctx,
          new Set(crm.data.deals.map((deal) => deal.id)),
        );
        return {
          dash: buildDashboardFromInputs(ctx, {
            deals: crm.data.deals,
            companies: crm.data.companies,
            stages: crm.data.stages,
            ...input,
          }, { month: options.month, now: () => now }),
          followUps: buildFollowUpsFromDeals(crm.data.deals, now, input.settlements),
          pipelines: crm.data.pipelines,
          stages: crm.data.stages,
          deals: crm.data.deals,
        };
      }),
    crm.status === "unavailable"
      ? Promise.resolve(unavailable<DashboardLedgerData>(crm.operation))
      : capture("ledger", () => source.loadLedger(ctx, crm.data.deals.map((deal) => deal.id))),
  ]);

  return {
    core,
    boards: boardsSegment,
    notices: noticesSegment,
    ledger: ledgerSegment,
  };
}
