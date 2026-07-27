import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { WorkspaceEntry } from "@/components/workspace-entry/WorkspaceEntry";
import { loadWorkspaceRoutingSnapshot } from "@/lib/auth/workspace-entry-server";
import { decideApprovedRequestTarget, loadWorkspaceEntryContext } from "@/lib/workspace-entry/server";
import { parseWorkspaceEntryResume, WORKSPACE_ENTRY_RESUME_COOKIE } from "@/lib/workspace-entry/contracts";

export default async function WorkspaceEntryPage({ searchParams }: { searchParams: Promise<{ error?: string; mode?: string }> }) {
  const { error, mode } = await searchParams;
  const snapshot = await loadWorkspaceRoutingSnapshot();
  if (snapshot.kind === "unauthenticated") redirect("/login?next=/workspace-entry");
  if (snapshot.kind === "error") return <WorkspaceEntry initialView="rejected" />;
  const context = await loadWorkspaceEntryContext();
  if (context.kind === "error") return <WorkspaceEntry initialView="rejected" />;
  const resume = mode === "resume" ? parseWorkspaceEntryResume((await cookies()).get(WORKSPACE_ENTRY_RESUME_COOKIE)?.value) : null;
  const approvedTarget = decideApprovedRequestTarget(context.requests, snapshot.memberships, resume?.requestId);
  if (!error && mode === "resume" && approvedTarget.kind === "workspace") redirect(`/w/${approvedTarget.slug}`);
  if (!error && mode === "resume" && approvedTarget.kind === "invalid") return <WorkspaceEntry initialView="rejected" requests={context.requests} />;
  if (!error && mode !== "new" && mode !== "resume" && snapshot.memberships.length === 1) redirect(`/w/${snapshot.memberships[0].slug}`);
  if (!error && mode !== "new" && mode !== "resume" && snapshot.memberships.length > 1) redirect("/workspaces");
  return <WorkspaceEntry initialView={error ? "rejected" : "fork"} requests={mode === "new" ? [] : context.requests} isPlatformAdmin={context.isPlatformAdmin} platformRequests={context.platformCreateRequests} />;
}
