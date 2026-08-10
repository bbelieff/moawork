import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { WorkspaceEntry } from "@/components/workspace-entry/WorkspaceEntry";
import { loadWorkspaceRoutingSnapshot } from "@/lib/auth/workspace-entry-server";
import { decideApprovedRequestTarget, loadWorkspaceEntryContext } from "@/lib/workspace-entry/server";
import { parseWorkspaceEntryResume, WORKSPACE_ENTRY_RESUME_COOKIE } from "@/lib/workspace-entry/contracts";
import { decideWorkspaceEntryPage } from "./route-decision";

export default async function WorkspaceEntryPage({ searchParams }: { searchParams: Promise<{ error?: string; mode?: string }> }) {
  const { error, mode } = await searchParams;
  const snapshot = await loadWorkspaceRoutingSnapshot();
  if (snapshot.kind === "unauthenticated") redirect("/login?next=/workspace-entry");
  if (snapshot.kind === "error") return <WorkspaceEntry initialView="blocked" />;
  const context = await loadWorkspaceEntryContext();
  if (context.kind === "error") return <WorkspaceEntry initialView="blocked" />;
  const resume = mode === "resume" ? parseWorkspaceEntryResume((await cookies()).get(WORKSPACE_ENTRY_RESUME_COOKIE)?.value) : null;
  const approvedTarget = mode === "resume"
    ? decideApprovedRequestTarget(context.requests, snapshot.memberships, resume?.requestId)
    : { kind: "none" as const };
  const decision = decideWorkspaceEntryPage({
    authState: "ready",
    memberships: snapshot.memberships,
    mode,
    resumeTarget: approvedTarget,
    selfState: snapshot.selfRouteState === "eligible_entry" ? "eligible" : "blocked_inactive",
    isPlatformAdmin: context.isPlatformAdmin,
    hasRoutingError: Boolean(error),
  });
  if (decision.kind === "redirect") redirect(decision.path);
  if (decision.view === "blocked") return <WorkspaceEntry initialView="blocked" />;
  if (decision.view === "operator") return <WorkspaceEntry isPlatformAdmin platformRequests={context.platformCreateRequests} />;
  return <WorkspaceEntry requests={context.requests} />;
}
