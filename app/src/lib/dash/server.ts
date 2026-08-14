import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx, FieldDef, FieldOption, Settlement } from "@/lib/types";
import type { Notice } from "@/lib/notices/types";
import { AsyncCrmService, type PipelineWithStages } from "@/lib/crm/asyncService";
import { BoardsService } from "@/lib/boards/service";
import { NoticesService } from "@/lib/notices/service";
import { loadDealLedger } from "@/lib/accounting/server";
import { SupabaseBoardsRepo } from "@/lib/repo/supabase/boardsRepo";
import { SupabaseCrmSource } from "@/lib/repo/supabase/supabaseCrmSource";
import { createClient } from "@/lib/supabase/server";
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
 * contract explicitly; there is no implicit repository fallback.
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
  const source = options.source
    ?? createSupabaseDashboardSource(await (options.clientFactory ?? createClient)());
  const crm = await capture("crm", () => source.loadCrm(ctx));
  const now = options.now?.() ?? new Date();

  const core = crm.status === "unavailable"
    ? unavailable<DashboardCoreData>(crm.operation)
    : await capture("dashboard", async () => {
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
      });

  const [boardsSegment, noticesSegment, ledgerSegment] = await Promise.all([
    capture("boards", () => source.loadBoards(ctx)),
    capture("notices", () => source.loadNotices(ctx)),
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
