import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { WorkspaceEntry } from "@/components/workspace-entry/WorkspaceEntry";
import { loadWorkspaceRoutingSnapshot } from "@/lib/auth/workspace-entry-server";
import { decideApprovedRequestTarget, loadWorkspaceEntryContext } from "@/lib/workspace-entry/server";
import { parseWorkspaceEntryResume, WORKSPACE_ENTRY_RESUME_COOKIE } from "@/lib/workspace-entry/contracts";
import { parseInviteJoinSlug } from "@/lib/platform/customers/contracts";
import { safeNextPath } from "@/lib/auth/oauth";
import { decideWorkspaceEntryPage, decideWorkspaceEntryRecheckStrategy } from "./route-decision";

export default async function WorkspaceEntryPage({ searchParams }: { searchParams: Promise<{ error?: string; mode?: string; join?: string }> }) {
  const { error, mode, join } = await searchParams;
  // 승인 기반 초대의 안전한 주소다. 토큰을 싣지 않고 회사 주소만 싣는다.
  // 검증되지 않은 값은 버린다 — DB를 조회하지 않고 외부로도 나가지 않는다.
  const inviteJoin = typeof join === "string" ? parseInviteJoinSlug(join) : null;
  const inviteNext = inviteJoin ? `/workspace-entry?mode=new&join=${inviteJoin}` : "/workspace-entry";
  // The routing snapshot and the entry context read different tables for the
  // same user, so they are issued together. Redirect/blocked precedence below
  // is unchanged — only the wait is shared.
  const [snapshot, context] = await Promise.all([
    loadWorkspaceRoutingSnapshot(),
    loadWorkspaceEntryContext(),
  ]);
  if (snapshot.kind === "unauthenticated") redirect(`/login?next=${encodeURIComponent(safeNextPath(inviteNext, "/workspace-entry"))}`);
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
  return <WorkspaceEntry requests={context.requests} freshStart={mode === "new"} initialJoinSlug={mode === "new" ? inviteJoin : null} />;
}
