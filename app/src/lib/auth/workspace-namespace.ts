import { safeNextPath } from "@/lib/auth/oauth";
import { isCanonicalWorkspaceSlug, parseActiveMembershipRows, workspaceTargetFromNext } from "@/lib/auth/workspace-routing";
import { RESERVED_WORKSPACE_SLUGS } from "@/lib/workspace-entry/contracts";

export type WorkspaceNamespaceDecision =
  | { kind: "none" }
  | { kind: "deny" }
  | { kind: "alias"; canonical: `/w/${string}`; orgId: string }
  | { kind: "rewrite"; canonical: `/w/${string}`; internal: string; orgId: string };

const WORKSPACE_PAGE_SEGMENTS = new Set([
  "account", "boards", "companies", "contract", "dash", "deals", "newcust",
  "notices", "onboarding", "policyfund", "presets", "settings", "settlements", "work",
]);

const WORKSPACE_INTERNAL_ALIASES = new Map<string, string>([]);

function aliasFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/([^/]+)$/);
  const alias = match?.[1];
  return alias && isCanonicalWorkspaceSlug(alias)
    && !RESERVED_WORKSPACE_SLUGS.has(alias)
    && !WORKSPACE_PAGE_SEGMENTS.has(alias)
    ? alias
    : null;
}

export function isWorkspaceNamespaceCandidate(pathname: string): boolean {
  return pathname.startsWith("/w/") || aliasFromPath(pathname) !== null;
}

export function workspaceInternalPathFromCanonical(pathWithSearch: string, slug: string): string | null {
  const safe = safeNextPath(pathWithSearch, "");
  if (!safe || safe !== pathWithSearch || !isCanonicalWorkspaceSlug(slug)) return null;
  const url = new URL(safe, "https://moa-work.local");
  const prefix = `/w/${slug}`;
  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return null;
  const suffix = url.pathname.slice(prefix.length) || "/";
  if (suffix === "/w" || suffix.startsWith("/w/")) return null;
  const firstSegment = suffix.split("/").filter(Boolean)[0];
  if (firstSegment && !WORKSPACE_PAGE_SEGMENTS.has(firstSegment)) return null;
  return `${WORKSPACE_INTERNAL_ALIASES.get(suffix) ?? suffix}${url.search}`;
}

export function decideWorkspaceNamespace(pathWithSearch: string, rows: unknown): WorkspaceNamespaceDecision {
  const safe = safeNextPath(pathWithSearch, "");
  if (!safe || safe !== pathWithSearch) return pathWithSearch.startsWith("/w/") ? { kind: "deny" } : { kind: "none" };
  const url = new URL(safe, "https://moa-work.local");
  const parsed = parseActiveMembershipRows(rows);
  if (!parsed.ok) return isWorkspaceNamespaceCandidate(url.pathname) ? { kind: "deny" } : { kind: "none" };

  if (url.pathname.startsWith("/w/")) {
    const target = workspaceTargetFromNext(safe);
    if (target.kind !== "workspace") return { kind: "deny" };
    const matches = parsed.memberships.filter((membership) => membership.slug === target.slug);
    if (matches.length !== 1) return { kind: "deny" };
    const internal = workspaceInternalPathFromCanonical(safe, target.slug);
    if (!internal) return { kind: "deny" };
    return { kind: "rewrite", canonical: target.path, internal, orgId: matches[0].orgId };
  }

  const alias = aliasFromPath(url.pathname);
  if (!alias) return { kind: "none" };
  const matches = parsed.memberships.filter((membership) => membership.slug === alias);
  if (matches.length !== 1) return { kind: "deny" };
  return { kind: "alias", canonical: `/w/${alias}${url.search}`, orgId: matches[0].orgId };
}
