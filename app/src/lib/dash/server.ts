import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx, FieldDef, FieldOption, Settlement } from "@/lib/types";
import { getRepo } from "@/lib/repo";
import {
  isSupabaseConfigured,
  LocalCrmSource,
  SupabaseCrmSource,
  type CrmSource,
} from "@/lib/repo/supabase";
import { createClient } from "@/lib/supabase/server";
import {
  buildDashboardFromInputs,
  buildFollowUpsFromDeals,
  type DashboardData,
  type DashboardFollowUps,
} from "./service";

type Row = Record<string, unknown>;

export type DashboardPageData = Readonly<{
  dash: DashboardData;
  followUps: DashboardFollowUps;
  pipelines: Awaited<ReturnType<CrmSource["listPipelines"]>>;
  stages: Awaited<ReturnType<CrmSource["listStages"]>>;
  deals: Awaited<ReturnType<CrmSource["listDeals"]>>;
  sourceKind: CrmSource["kind"];
}>;

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

async function loadSupabaseInputs(
  ctx: Ctx,
  visibleDealIds: ReadonlySet<string>,
  client: SupabaseClient,
) {
  const fieldsPromise = client
    .from("field_defs")
    .select("id,org_id,entity,key,label,type,options_jsonb,module_key,sort_order")
    .eq("org_id", ctx.org.id)
    .eq("entity", "deal")
    .order("sort_order");
  const settlementsPromise = visibleDealIds.size === 0
    ? Promise.resolve({ data: [], error: null })
    : client
      .from("settlements")
      .select("id,org_id,deal_id,down_payment,down_paid_at,exec_amount,fee_pct,fee_paid_at,fee_amount,total_revenue,d180,d365,created_at")
      .eq("org_id", ctx.org.id)
      .in("deal_id", [...visibleDealIds])
      .order("created_at", { ascending: false });
  const [fieldsResult, settlementsResult] = await Promise.all([
    fieldsPromise,
    settlementsPromise,
  ]);
  if (fieldsResult.error || !Array.isArray(fieldsResult.data)) {
    throw new DashboardReadError("field_defs");
  }
  if (settlementsResult.error || !Array.isArray(settlementsResult.data)) {
    throw new DashboardReadError("settlements");
  }
  return {
    fieldDefs: (fieldsResult.data as Row[]).map(fieldDef),
    settlements: (settlementsResult.data as Row[]).map(settlement),
  };
}

export async function loadDashboardPageData(
  ctx: Ctx,
  options: {
    month?: string;
    now?: () => Date;
    source?: CrmSource;
    clientFactory?: () => Promise<SupabaseClient>;
    supabaseConfigured?: boolean;
    sourceFactory?: (client: SupabaseClient) => CrmSource;
  } = {},
): Promise<DashboardPageData> {
  let requestClient: SupabaseClient | undefined;
  let source = options.source;
  if (!source && (options.supabaseConfigured ?? isSupabaseConfigured())) {
    requestClient = await (options.clientFactory ?? createClient)();
    source = (options.sourceFactory ?? ((client) => new SupabaseCrmSource(client)))(requestClient);
  }
  source ??= new LocalCrmSource();
  const [deals, companies, pipelines] = await Promise.all([
    source.listDeals(ctx),
    source.listCompanies(ctx),
    source.listPipelines(ctx.org.id),
  ]);
  const stages = (await Promise.all(pipelines.map((pipeline) => source.listStages(pipeline.id)))).flat();
  const extra = source.kind === "supabase"
    ? await loadSupabaseInputs(
        ctx,
        new Set(deals.map((deal) => deal.id)),
        requestClient ?? await (options.clientFactory ?? createClient)(),
      )
    : {
        fieldDefs: getRepo().listFieldDefs(ctx.org.id, "deal"),
        settlements: getRepo().listSettlements(ctx),
      };
  const now = options.now?.() ?? new Date();
  return {
    dash: buildDashboardFromInputs(ctx, { deals, companies, stages, ...extra }, {
      month: options.month,
      now: () => now,
    }),
    followUps: buildFollowUpsFromDeals(deals, now, extra.settlements),
    pipelines,
    stages,
    deals,
    sourceKind: source.kind,
  };
}
