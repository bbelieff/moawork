import { notFound } from "next/navigation";
import { applyAs, getSession } from "@/lib/auth/session";
import { getCrmService, NotFoundError } from "@/lib/crm";
import { CompanyDetail } from "@/components/company/CompanyDetail";

export default async function CompanyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ as?: string }>;
}) {
  const [{ companyId }, sp] = await Promise.all([params, searchParams]);
  const ctx = applyAs(await getSession(), sp.as);
  const svc = getCrmService();

  let company;
  try {
    company = await svc.getCompany(ctx, companyId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const [deals, pipelines] = await Promise.all([
    svc.listDeals(ctx, { companyId: company.id }),
    svc.listPipelines(ctx),
  ]);
  const stageNames = new Map(
    pipelines.flatMap((pipeline) => pipeline.stages.map((stage) => [stage.id, stage.name] as const)),
  );

  return <CompanyDetail company={company} deals={deals} stageNames={stageNames} />;
}
