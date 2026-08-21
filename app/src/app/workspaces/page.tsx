import { redirect } from "next/navigation";
import { WorkspaceChooser } from "@/components/workspace-entry/WorkspaceChooser";
import { loadWorkspaceRoutingSnapshot } from "@/lib/auth/workspace-entry-server";
import { loadOrgActionCounts } from "@/lib/notify/server";
import { loadOwnerWorkspaceDeletionRows } from "@/lib/workspace-deletion/server";
import { WorkspaceManagementPanel } from "@/components/account/WorkspaceManagementPanel";
import accountStyles from "@/components/account/account.module.css";

export default async function WorkspacesPage() {
  const snapshot = await loadWorkspaceRoutingSnapshot();
  if (snapshot.kind === "unauthenticated") redirect("/login?next=/workspaces");
  if (snapshot.kind === "error") redirect("/workspace-entry?error=routing");
  const ownerRows = await loadOwnerWorkspaceDeletionRows().catch(() => null);
  if (!ownerRows) return <main className={accountStyles.page}><WorkspaceManagementPanel workspaces={[]} loadError /></main>;
  const pending = ownerRows.filter((row) => row.status === "pending_delete");
  if (snapshot.memberships.length === 0) {
    if (pending.length === 0) redirect("/workspace-entry?error=routing");
    return <main className={accountStyles.page}><header className={accountStyles.heading}><h1>삭제 예정 회사</h1><p>데이터는 보존 중이며 대표가 다시 사용할 수 있게 되돌릴 수 있어요.</p></header><WorkspaceManagementPanel workspaces={pending} /></main>;
  }
  if (snapshot.memberships.length === 1) redirect(`/w/${snapshot.memberships[0].slug}`);
  // 회사별 내 할 일 건수(건수만). 실패해도 빈 값이라 선택 화면은 그대로 뜬다.
  const badges = await loadOrgActionCounts();
  return <WorkspaceChooser workspaces={snapshot.memberships} badges={badges} />;
}
