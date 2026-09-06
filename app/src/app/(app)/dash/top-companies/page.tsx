import { FeatureGateServer } from "@/components/auth/FeatureGateServer";
import { MonthlyContractCompaniesPage } from "@/components/dashboard/MonthlyContractCompaniesPage";
import { getSession } from "@/lib/auth/session";
import { loadMonthlyContractCompanies } from "@/lib/perf/server";
import { FEATURES } from "@/lib/product";
import type { Ctx } from "@/lib/types";

async function Content({ month, ctx }: { month?: string; ctx: Ctx }) {
  const data = await loadMonthlyContractCompanies(ctx, { period: month });
  return <MonthlyContractCompaniesPage data={data} scope={ctx.scope} />;
}

export default async function TopCompaniesRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const month = typeof params.month === "string" ? params.month : undefined;
  const ctx = await getSession();
  return <FeatureGateServer orgId={ctx.org.id} feature={FEATURES.dash} label="대시보드"><Content month={month} ctx={ctx} /></FeatureGateServer>;
}
