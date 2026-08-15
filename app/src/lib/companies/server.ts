import type { SupabaseClient } from "@supabase/supabase-js";
import { summarizeDealLedger } from "@/lib/accounting";
import { loadDealLedger } from "@/lib/accounting/server";
import { AsyncCrmService } from "@/lib/crm/asyncService";
import { SupabaseCrmSource } from "@/lib/repo/supabase/supabaseCrmSource";
import { createClient } from "@/lib/supabase/server";
import type { Company, Ctx, Deal } from "@/lib/types";

export type CompanyDealView = Readonly<{
  deal: Deal;
  ledger:
    | Readonly<{ status: "ready"; total: number; received: number; outstanding: number; fee: number }>
    | Readonly<{ status: "error" }>;
}>;

export type CompanyView = Readonly<{
  company: Company;
  deals: readonly CompanyDealView[];
}>;

export type CompaniesViewModel =
  | Readonly<{ status: "error" }>
  | Readonly<{
      status: "ready";
      companies: readonly CompanyView[];
      dealsStatus: "ready" | "error";
    }>;

/**
 * 요청에 결속된 Supabase 세션 하나로 회사·딜·원장을 읽는다.
 * RLS가 조직과 담당범위를 제한하며, 어떤 DB 오류도 빈 배열이나 0원으로 바꾸지 않는다.
 */
export async function loadCompaniesView(
  ctx: Ctx,
  clientFactory: () => Promise<SupabaseClient> = createClient,
): Promise<CompaniesViewModel> {
  const client = await clientFactory();
  const crm = new AsyncCrmService(new SupabaseCrmSource(client));
  const [companiesResult, dealsResult] = await Promise.allSettled([
    crm.listCompanies(ctx),
    crm.listDeals(ctx),
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
          try {
            const model = await loadDealLedger(deal.id, async () => client);
            const summary = summarizeDealLedger(deal.id, model.entries);
            return {
              deal,
              ledger: {
                status: "ready",
                total: summary.ledgerTotal,
                received: summary.receivedTotal,
                outstanding: summary.outstandingTotal,
                fee: summary.feeTotal,
              },
            };
          } catch {
            return { deal, ledger: { status: "error" } };
          }
        }),
      );
      return { company, deals: views };
    }),
  );

  return { status: "ready", companies, dealsStatus: "ready" };
}
