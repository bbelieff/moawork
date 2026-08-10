import { redirect } from "next/navigation";
import { WorkspaceChooser } from "@/components/workspace-entry/WorkspaceChooser";
import { loadWorkspaceRoutingSnapshot } from "@/lib/auth/workspace-entry-server";
import { loadOrgActionCounts } from "@/lib/notify/server";

export default async function WorkspacesPage() {
  const snapshot = await loadWorkspaceRoutingSnapshot();
  if (snapshot.kind === "unauthenticated") redirect("/login?next=/workspaces");
  if (snapshot.kind === "error" || snapshot.memberships.length === 0) redirect("/workspace-entry?error=routing");
  if (snapshot.memberships.length === 1) redirect(`/w/${snapshot.memberships[0].slug}`);
  // 회사별 내 할 일 건수(건수만). 실패해도 빈 값이라 선택 화면은 그대로 뜬다.
  const badges = await loadOrgActionCounts();
  return <WorkspaceChooser workspaces={snapshot.memberships} badges={badges} />;
}
