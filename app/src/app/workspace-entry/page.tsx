import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { WorkspaceEntry } from "@/components/workspace-entry/WorkspaceEntry";
import { loadWorkspaceRoutingSnapshot } from "@/lib/auth/workspace-entry-server";
import { decideApprovedRequestTarget, loadWorkspaceEntryContext } from "@/lib/workspace-entry/server";
import { parseWorkspaceEntryResume, WORKSPACE_ENTRY_RESUME_COOKIE } from "@/lib/workspace-entry/contracts";
import { decideWorkspaceEntryPage, decideWorkspaceEntryRecheckStrategy } from "./route-decision";

export default async function WorkspaceEntryPage({ searchParams }: { searchParams: Promise<{ error?: string; mode?: string }> }) {
  const { error, mode } = await searchParams;
  // The routing snapshot and the entry context read different tables for the
  // same user, so they are issued together. Redirect/blocked precedence below
  // is unchanged — only the wait is shared.
  const [snapshot, context] = await Promise.all([
    loadWorkspaceRoutingSnapshot(),
    loadWorkspaceEntryContext(),
  ]);
  if (snapshot.kind === "unauthenticated") redirect("/login?next=/workspace-entry");
  if (snapshot.kind === "error") return <WorkspaceEntry initialView="blocked" />;
  if (context.kind === "error") return <WorkspaceEntry initialView="blocked" />;
  const resume = mode === "resume" ? parseWorkspaceEntryResume((await cookies()).get(WORKSPACE_ENTRY_RESUME_COOKIE)?.value) : null;
  const approvedTarget = mode === "resume"
    ? decideApprovedRequestTarget(context.requests, snapshot.memberships, resume?.requestId)
    : { kind: "none" as const };
  const hasRoutingError = Boolean(error);
  const decision = decideWorkspaceEntryPage({
    authState: "ready",
    memberships: snapshot.memberships,
    mode,
    resumeTarget: approvedTarget,
    selfState: snapshot.selfRouteState === "eligible_entry" ? "eligible" : "blocked_inactive",
    isPlatformAdmin: context.isPlatformAdmin,
    hasRoutingError,
  });
  if (decision.kind === "redirect") redirect(decision.path);
  if (decision.view === "blocked") {
    return <WorkspaceEntry initialView="blocked" recheckStrategy={decideWorkspaceEntryRecheckStrategy(hasRoutingError)} />;
  }
  if (decision.view === "operator") return <WorkspaceEntry isPlatformAdmin platformRequests={context.platformCreateRequests} />;
  return <WorkspaceEntry requests={context.requests} freshStart={mode === "new"} />;
}
