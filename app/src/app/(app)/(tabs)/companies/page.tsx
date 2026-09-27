import { CompaniesWorkspace } from "@/components/companies/CompaniesWorkspace";
import { CompanyCsvImport } from "@/components/companies/CompanyCsvImport";
import { applyAs, getSession } from "@/lib/auth/session";
import { isManager } from "@/lib/auth/roles";
import { loadCompaniesView } from "@/lib/companies/server";
import { loadDefaultTabAssignees } from "@/lib/boards/default-tab-assignees";
import { importCompaniesCsvAction } from "./actions";

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const sp = await searchParams;
  const ctx = applyAs(await getSession(), sp.as);
  const model = await loadCompaniesView(ctx);
  // 담당 목록 조회 실패를 빈값으로 숨기지 않는다 — 빈 목록과 조회 장애를 구분해
  // 담당 변경만 차단하고 다른 작업은 유지한다.
  let members: { id: string; label: string }[] = [];
  let membersError: string | null = null;
  try {
    members = (await loadDefaultTabAssignees(ctx)).map((member) => ({
      id: member.userId,
      label: member.displayName,
    }));
  } catch {
    membersError = "담당자 목록을 불러오지 못했습니다. 담당 변경만 할 수 없고, 다른 작업은 그대로 할 수 있습니다.";
  }
  // 가져오기는 조직 데이터를 늘리는 동작이라 관리자에게만 보인다.
  // (액션 안에서도 다시 막는다 — 화면에서 감추는 것은 권한이 아니다.)
  return (
    <CompaniesWorkspace
      model={model}
      members={members}
      membersError={membersError}
      importSlot={isManager(ctx.role) ? <CompanyCsvImport importCsv={importCompaniesCsvAction} /> : null}
    />
  );
}
