import { CompaniesWorkspace } from "@/components/companies/CompaniesWorkspace";
import { CompanyCsvImport } from "@/components/companies/CompanyCsvImport";
import { applyAs, getSession } from "@/lib/auth/session";
import { isManager } from "@/lib/auth/roles";
import { loadCompaniesView } from "@/lib/companies/server";
import { importCompaniesCsvAction } from "./actions";

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const sp = await searchParams;
  const ctx = applyAs(await getSession(), sp.as);
  const model = await loadCompaniesView(ctx);
  // 가져오기는 조직 데이터를 늘리는 동작이라 관리자에게만 보인다.
  // (액션 안에서도 다시 막는다 — 화면에서 감추는 것은 권한이 아니다.)
  return (
    <CompaniesWorkspace
      model={model}
      importSlot={isManager(ctx.role) ? <CompanyCsvImport importCsv={importCompaniesCsvAction} /> : null}
    />
  );
}
