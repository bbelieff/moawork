/**
 * CHECKPOINT PUBLIC-WORKSPACE-ENTRY-01
 * stage=FIRST_WRITE base=00929168ea440a2532e632b7141135b956b91fca
 * lease=app/src/lib/auth/workspace-routing.ts next=materialize-routing-tests
 */
import { safeNextPath } from "@/lib/auth/oauth";

const WORKSPACE_SLUG =
  /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,38}[a-z0-9]$/;

const INACTIVE_MEMBERSHIP_STATUSES = new Set([
  "invited",
  "pending",
  "suspended",
  "removed",
  "leave",
  "expired",
]);

const INACTIVE_WORKSPACE_STATUSES = new Set([
  "provisioning",
  "suspended",
  "pending_delete",
  "deleted",
]);

export type WorkspaceMembershipRow = Record<string, unknown> & {
  org_id?: unknown;
  status?: unknown;
  orgs?: unknown;
};

export type ActiveWorkspaceMembership = {
  orgId: string;
  slug: string;
  source: WorkspaceMembershipRow;
};

export type ParsedActiveMemberships =
  | { ok: true; memberships: ActiveWorkspaceMembership[] }
  | { ok: false; memberships: [] };

export type WorkspaceTargetHint =
  | { kind: "none" }
  | { kind: "workspace"; slug: string; path: `/w/${string}` }
  | { kind: "invalid" };

export type WorkspaceDestination =
  | {
      kind: "workspace";
      path: `/w/${string}`;
      orgId: string;
      slug: string;
    }
  | { kind: "entry"; path: "/workspace-entry" }
  | { kind: "chooser"; path: "/workspaces" }
  | {
      kind: "fail-closed";
      path: "/workspace-entry?error=routing";
    };

function nonEmptyText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function relation(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === "object"
    ? (candidate as Record<string, unknown>)
    : null;
}

function knownInactiveStatus(
  value: unknown,
  inactiveValues: Set<string>,
): boolean | null {
  if (value === "active") return false;
  if (typeof value === "string" && inactiveValues.has(value)) return true;
  return null;
}

export function isCanonicalWorkspaceSlug(value: unknown): value is string {
  return typeof value === "string" && WORKSPACE_SLUG.test(value);
}

/**
 * Rows are treated as authorization input, not presentation data. Unknown
 * status values, malformed relations, and duplicate org/slug identities fail
 * the whole decision closed instead of selecting a convenient first row.
 */
export function parseActiveMembershipRows(
  rows: unknown,
): ParsedActiveMemberships {
  if (!Array.isArray(rows)) return { ok: false, memberships: [] };

  const memberships: ActiveWorkspaceMembership[] = [];
  const orgIds = new Set<string>();
  const slugs = new Set<string>();

  for (const candidate of rows) {
    if (!candidate || typeof candidate !== "object") {
      return { ok: false, memberships: [] };
    }

    const row = candidate as WorkspaceMembershipRow;
    const membershipInactive = knownInactiveStatus(
      row.status,
      INACTIVE_MEMBERSHIP_STATUSES,
    );
    if (membershipInactive === null) return { ok: false, memberships: [] };
    if (membershipInactive) continue;

    const org = relation(row.orgs);
    if (!org) return { ok: false, memberships: [] };
    const workspaceInactive = knownInactiveStatus(
      org.status,
      INACTIVE_WORKSPACE_STATUSES,
    );
    if (workspaceInactive === null) return { ok: false, memberships: [] };
    if (workspaceInactive) continue;

    const orgId = nonEmptyText(row.org_id);
    const relationId = nonEmptyText(org.id);
    const slug = nonEmptyText(org.slug);
    if (
      !orgId ||
      relationId !== orgId ||
      !isCanonicalWorkspaceSlug(slug) ||
      orgIds.has(orgId) ||
      slugs.has(slug)
    ) {
      return { ok: false, memberships: [] };
    }

    orgIds.add(orgId);
    slugs.add(slug);
    memberships.push({ orgId, slug, source: row });
  }

  return { ok: true, memberships };
}

/** Only a sanitized /w/{slug} path and its same-workspace suffix can be a protected target. */
export function workspaceTargetFromNext(value: unknown): WorkspaceTargetHint {
  if (typeof value !== "string" || value.trim() === "") {
    return { kind: "none" };
  }

  const raw = value.trim();
  const wasWorkspaceCandidate = raw.startsWith("/w/");
  const trimmed = safeNextPath(raw, "");
  if (!trimmed) return { kind: "invalid" };
  if (!trimmed.startsWith("/w/")) return wasWorkspaceCandidate ? { kind: "invalid" } : { kind: "none" };
  if (!trimmed || trimmed !== raw) return { kind: "invalid" };

  try {
    const parsed = new URL(trimmed, "https://moa-work.local");
    const match = parsed.pathname.match(/^\/w\/([^/]+)(?:\/.*)?$/);
    if (!match || !isCanonicalWorkspaceSlug(match[1])) {
      return { kind: "invalid" };
    }
    return { kind: "workspace", slug: match[1], path: `${parsed.pathname}${parsed.search}${parsed.hash}` as `/w/${string}` };
  } catch {
    return { kind: "invalid" };
  }
}

export function decideWorkspaceDestination(
  rows: unknown,
  target: WorkspaceTargetHint = { kind: "none" },
): WorkspaceDestination {
  const parsed = parseActiveMembershipRows(rows);
  if (!parsed.ok || target.kind === "invalid") {
    return { kind: "fail-closed", path: "/workspace-entry?error=routing" };
  }

  if (target.kind === "workspace") {
    const matches = parsed.memberships.filter(
      (membership) => membership.slug === target.slug,
    );
    if (matches.length !== 1) {
      return { kind: "fail-closed", path: "/workspace-entry?error=routing" };
    }
    const membership = matches[0];
    return {
      kind: "workspace",
      path: target.path,
      orgId: membership.orgId,
      slug: membership.slug,
    };
  }

  if (parsed.memberships.length === 0) {
    return { kind: "entry", path: "/workspace-entry" };
  }
  if (parsed.memberships.length > 1) {
    return { kind: "chooser", path: "/workspaces" };
  }

  const membership = parsed.memberships[0];
  return {
    kind: "workspace",
    path: `/w/${membership.slug}`,
    orgId: membership.orgId,
    slug: membership.slug,
  };
}

export function chooseSessionMembership(
  rows: unknown,
  preferredOrgId?: string,
): ActiveWorkspaceMembership | null {
  const parsed = parseActiveMembershipRows(rows);
  if (!parsed.ok) return null;
  if (preferredOrgId) {
    return (
      parsed.memberships.find(
        (membership) => membership.orgId === preferredOrgId,
      ) ?? null
    );
  }
  return parsed.memberships.length === 1 ? parsed.memberships[0] : null;
}
