import { isCanonicalWorkspaceSlug } from "@/lib/auth/workspace-routing";

export type WorkspaceEntrySelfState = "eligible" | "blocked_inactive" | "unknown";
export type WorkspaceEntryResumeTarget = { kind: "none" } | { kind: "invalid" } | { kind: "workspace"; slug: string };
export type WorkspaceEntryPageDecision =
  | { kind: "redirect"; path: `/w/${string}` | "/workspaces" | "/platform/workspace-requests" | "/login?next=/workspace-entry" }
  | { kind: "render"; view: "entry" | "blocked" | "operator" };

export function decideWorkspaceEntryPage({
  authState,
  memberships,
  mode,
  resumeTarget,
  selfState,
  isPlatformAdmin,
  hasRoutingError = false,
}: {
  authState: "ready" | "unauthenticated" | "error";
  memberships: { slug: string }[];
  mode?: string;
  resumeTarget: WorkspaceEntryResumeTarget;
  selfState: WorkspaceEntrySelfState;
  isPlatformAdmin: boolean;
  hasRoutingError?: boolean;
}): WorkspaceEntryPageDecision {
  if (authState === "unauthenticated") return { kind: "redirect", path: "/login?next=/workspace-entry" };
  if (authState === "error" || hasRoutingError) return { kind: "render", view: "blocked" };

  if (mode === "resume") {
    if (resumeTarget.kind === "invalid") return { kind: "render", view: "blocked" };
    if (resumeTarget.kind === "workspace") {
      return isCanonicalWorkspaceSlug(resumeTarget.slug)
        ? { kind: "redirect", path: `/w/${resumeTarget.slug}` }
        : { kind: "render", view: "blocked" };
    }
  }

  if (memberships.length === 1) {
    return isCanonicalWorkspaceSlug(memberships[0].slug)
      ? { kind: "redirect", path: `/w/${memberships[0].slug}` }
      : { kind: "render", view: "blocked" };
  }
  if (memberships.length > 1) return { kind: "redirect", path: "/workspaces" };
  if (selfState !== "eligible") return { kind: "render", view: "blocked" };
  if (isPlatformAdmin) return { kind: "redirect", path: "/platform/workspace-requests" };
  return { kind: "render", view: "entry" };
}
