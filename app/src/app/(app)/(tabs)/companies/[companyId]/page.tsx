import { notFound } from "next/navigation";
import { applyAs, getSession } from "@/lib/auth/session";
import { getCrmService, NotFoundError } from "@/lib/crm";
import { CompanyDetail } from "@/components/company/CompanyDetail";
import { startCompanyWorkAction } from "./actions";

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function CompanyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ as?: string; workStart?: string; dealId?: string; requestId?: string }>;
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

  const workStartStatus = sp.workStart === "ok" || sp.workStart === "failed" || sp.workStart === "invalid" ? sp.workStart : undefined;
  const workStartRequestId = workStartStatus === "failed" && sp.requestId && REQUEST_ID_PATTERN.test(sp.requestId)
    ? sp.requestId
    : crypto.randomUUID();
  return <CompanyDetail company={company} deals={deals} stageNames={stageNames} workStartRequestId={workStartRequestId} workStartStatus={workStartStatus} startedDealId={sp.dealId} startWorkAction={startCompanyWorkAction} />;
}
