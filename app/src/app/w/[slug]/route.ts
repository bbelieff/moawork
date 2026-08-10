import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { loadWorkspaceRoutingSnapshot, type WorkspaceRoutingSnapshot } from "@/lib/auth/workspace-entry-server";
import { isCanonicalWorkspaceSlug } from "@/lib/auth/workspace-routing";
import { workspaceInternalPathFromCanonical } from "@/lib/auth/workspace-namespace";
import { WORKSPACE_ENTRY_RESUME_COOKIE } from "@/lib/workspace-entry/contracts";

type SnapshotLoader = () => Promise<WorkspaceRoutingSnapshot>;

function workspacePath(request: Request, slug: string): { canonical: string; internal: string } | null {
  if (!isCanonicalWorkspaceSlug(slug)) return null;
  const url = new URL(request.url);
  const raw = `${url.pathname}${url.search}`;
  const internal = workspaceInternalPathFromCanonical(raw, slug);
  return internal ? { canonical: raw, internal } : null;
}

export async function handleWorkspaceTarget(
  request: Request,
  slug: string,
  loadSnapshot: SnapshotLoader = loadWorkspaceRoutingSnapshot,
): Promise<Response> {
  const target = workspacePath(request, slug);
  const snapshot = await loadSnapshot();
  if (snapshot.kind === "unauthenticated") {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", target?.canonical ?? "/workspace-entry");
    return NextResponse.redirect(login);
  }

  const matched = snapshot.kind === "ready" && target
    ? snapshot.memberships.filter((membership) => membership.slug === slug)
    : [];
  if (matched.length !== 1) {
    const denied = NextResponse.redirect(new URL("/workspace-entry?error=routing", request.url));
    denied.cookies.delete(SESSION_COOKIE.org);
    return denied;
  }

  const response = NextResponse.rewrite(new URL(target!.internal, request.url));
  response.cookies.set(SESSION_COOKIE.org, matched[0].orgId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  response.cookies.delete(WORKSPACE_ENTRY_RESUME_COOKIE);
  return response;
}

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await context.params;
  return handleWorkspaceTarget(request, slug);
}
