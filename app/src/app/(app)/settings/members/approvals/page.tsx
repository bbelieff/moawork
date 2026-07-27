import { redirect } from "next/navigation";
import { ApprovalQueue } from "@/components/workspace-entry/ApprovalQueue";
import { getSession } from "@/lib/auth/session";
import { loadWorkspaceEntryContext } from "@/lib/workspace-entry/server";

export default async function WorkspaceJoinApprovalsPage() {
  const ctx = await getSession();
  if (ctx.role !== "owner") redirect("/settings/members");
  const context = await loadWorkspaceEntryContext(ctx.org.id);
  if (context.kind === "error") redirect("/settings/members?error=approvals");
  return <div className="mx-auto max-w-3xl"><ApprovalQueue mode="owner" requests={context.ownerJoinRequests} workspaceName={ctx.org.name} /></div>;
}
