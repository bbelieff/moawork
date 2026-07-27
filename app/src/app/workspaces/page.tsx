import { redirect } from "next/navigation";
import { WorkspaceChooser } from "@/components/workspace-entry/WorkspaceChooser";
import { loadWorkspaceRoutingSnapshot } from "@/lib/auth/workspace-entry-server";

export default async function WorkspacesPage() {
  const snapshot = await loadWorkspaceRoutingSnapshot();
  if (snapshot.kind === "unauthenticated") redirect("/login?next=/workspaces");
  if (snapshot.kind === "error" || snapshot.memberships.length === 0) redirect("/workspace-entry?error=routing");
  if (snapshot.memberships.length === 1) redirect(`/w/${snapshot.memberships[0].slug}`);
  return <WorkspaceChooser workspaces={snapshot.memberships} />;
}
