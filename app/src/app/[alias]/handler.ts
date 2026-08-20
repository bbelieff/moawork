import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { loadWorkspaceRoutingSnapshot, type WorkspaceRoutingSnapshot } from "@/lib/auth/workspace-entry-server";
import { isCanonicalWorkspaceSlug } from "@/lib/auth/workspace-routing";
import { RESERVED_WORKSPACE_SLUGS } from "@/lib/workspace-entry/contracts";

type SnapshotLoader = () => Promise<WorkspaceRoutingSnapshot>;

export async function handleWorkspaceAlias(request: Request, alias: string, loadSnapshot: SnapshotLoader = loadWorkspaceRoutingSnapshot): Promise<Response> {
  if (!isCanonicalWorkspaceSlug(alias) || RESERVED_WORKSPACE_SLUGS.has(alias)) return NextResponse.redirect(new URL("/workspace-entry?error=routing", request.url));
  const snapshot = await loadSnapshot();
  const source = new URL(request.url);
  const canonicalPath = `/w/${alias}${source.search}` as const;
  if (snapshot.kind === "unauthenticated") {
    const login = new URL("/login", source.origin);
    login.searchParams.set("next", canonicalPath);
    return NextResponse.redirect(login);
  }
  const matches = snapshot.kind === "ready" ? snapshot.memberships.filter((membership) => membership.slug === alias) : [];
  if (matches.length !== 1) return NextResponse.redirect(new URL("/workspace-entry?error=routing", source.origin));
  const response = NextResponse.redirect(new URL(canonicalPath, source.origin));
  response.cookies.set(SESSION_COOKIE.org, matches[0].orgId, { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return response;
}
