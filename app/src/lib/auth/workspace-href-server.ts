import { workspaceHref } from "@/components/shell/workspace-href";
import { getSession } from "@/lib/auth/session";
import { loadWorkspaceRoutingSnapshot } from "@/lib/auth/workspace-entry-server";

export async function loadVerifiedWorkspaceBasePath(): Promise<string | undefined> {
  const [ctx, routing] = await Promise.all([getSession(), loadWorkspaceRoutingSnapshot()]);
  if (routing.kind !== "ready") return undefined;
  const matches = routing.memberships.filter((membership) => membership.orgId === ctx.org.id);
  return matches.length === 1 ? `/w/${matches[0].slug}` : undefined;
}

export async function workspaceServerHref(href: string): Promise<string> {
  return workspaceHref(await loadVerifiedWorkspaceBasePath(), href);
}
