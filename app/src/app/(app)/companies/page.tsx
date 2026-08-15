import { CompaniesWorkspace } from "@/components/companies/CompaniesWorkspace";
import { applyAs, getSession } from "@/lib/auth/session";
import { loadCompaniesView } from "@/lib/companies/server";

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const sp = await searchParams;
  const ctx = applyAs(await getSession(), sp.as);
  const model = await loadCompaniesView(ctx);
  return <CompaniesWorkspace model={model} />;
}
