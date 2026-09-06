import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { AsyncCrmService } from "@/lib/crm/asyncService";
import { currentMonthKst } from "@/lib/dash/service";
import { SupabaseCrmSource } from "@/lib/repo/supabase/supabaseCrmSource";
import { createClient } from "@/lib/supabase/server";
import type { Ctx, Settlement } from "@/lib/types";
import { buildMonthlyContractCompanies } from "./aggregate";
import type { MonthlyContractCompanies } from "./types";

type Row = Record<string, unknown>;

export interface MonthlyContractCompaniesSource {
  load(ctx: Ctx): Promise<{
    deals: Awaited<ReturnType<AsyncCrmService["listDeals"]>>;
    companies: Awaited<ReturnType<AsyncCrmService["listCompanies"]>>;
    settlements: Settlement[];
  }>;
}

export class MonthlyContractCompaniesReadError extends Error {
  constructor(readonly operation: "settlements" | "parse") {
    super(`monthly contract companies could not be loaded (${operation})`);
    this.name = "MonthlyContractCompaniesReadError";
  }
}

function requiredText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new MonthlyContractCompaniesReadError("parse");
  return value;
}

function nullableText(value: unknown): string | null {
  if (value === null) return null;
  return requiredText(value);
}

function finiteNumber(value: unknown): number {
  if (typeof value !== "number" && (typeof value !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))) {
    throw new MonthlyContractCompaniesReadError("parse");
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new MonthlyContractCompaniesReadError("parse");
  return parsed;
}

function nullableTimestamp(value: unknown): string | null {
  if (value === null) return null;
  const parsed = requiredText(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(parsed) || Number.isNaN(Date.parse(parsed))) {
    throw new MonthlyContractCompaniesReadError("parse");
  }
  return parsed;
}

function nullableDate(value: unknown): string | null {
  if (value === null) return null;
  const parsed = requiredText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(parsed);
  if (!match) throw new MonthlyContractCompaniesReadError("parse");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new MonthlyContractCompaniesReadError("parse");
  }
  return parsed;
}

function requiredTimestamp(value: unknown): string {
  const parsed = nullableTimestamp(value);
  if (parsed === null) throw new MonthlyContractCompaniesReadError("parse");
  return parsed;
}

function parseSettlement(row: Row): Settlement {
  return {
    id: requiredText(row.id),
    org_id: requiredText(row.org_id),
    deal_id: nullableText(row.deal_id),
    down_payment: finiteNumber(row.down_payment),
    down_paid_at: nullableDate(row.down_paid_at),
    exec_amount: finiteNumber(row.exec_amount),
    fee_pct: finiteNumber(row.fee_pct),
    fee_paid_at: nullableDate(row.fee_paid_at),
    fee_amount: finiteNumber(row.fee_amount),
    total_revenue: finiteNumber(row.total_revenue),
    d180: nullableDate(row.d180),
    d365: nullableDate(row.d365),
    created_at: requiredTimestamp(row.created_at),
  };
}

function createSource(client: SupabaseClient): MonthlyContractCompaniesSource {
  const crm = new AsyncCrmService(new SupabaseCrmSource(client));
  return {
    async load(ctx) {
      const [deals, companies] = await Promise.all([crm.listDeals(ctx), crm.listCompanies(ctx)]);
      const visibleDealIds = new Set(deals.map((deal) => deal.id));
      if (visibleDealIds.size === 0) return { deals, companies, settlements: [] };
      const result = await client
        .from("settlements")
        .select("id,org_id,deal_id,down_payment,down_paid_at,exec_amount,fee_pct,fee_paid_at,fee_amount,total_revenue,d180,d365,created_at")
        .eq("org_id", ctx.org.id)
        .in("deal_id", [...visibleDealIds])
        .order("fee_paid_at", { ascending: false });
      if (result.error || !Array.isArray(result.data)) {
        throw new MonthlyContractCompaniesReadError("settlements");
      }
      return {
        deals,
        companies,
        settlements: (result.data as Row[]).map(parseSettlement).filter((row) =>
          row.org_id === ctx.org.id && row.deal_id !== null && visibleDealIds.has(row.deal_id)),
      };
    },
  };
}

export function normalizeTopCompaniesPeriod(value: string | undefined, now = new Date()): string {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value;
  return currentMonthKst(now);
}

export async function loadMonthlyContractCompanies(
  ctx: Ctx,
  options: { period?: string; now?: Date; source?: MonthlyContractCompaniesSource; clientFactory?: () => Promise<SupabaseClient> } = {},
): Promise<MonthlyContractCompanies> {
  const period = normalizeTopCompaniesPeriod(options.period, options.now);
  const source = options.source ?? createSource(await (options.clientFactory ?? createClient)());
  const input = await source.load(ctx);
  return buildMonthlyContractCompanies(input.settlements, input.deals, input.companies, period);
}
