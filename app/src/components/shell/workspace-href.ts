const CANONICAL_WORKSPACE_BASE = /^\/w\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const WORKSPACE_ROUTING_FALLBACK = "/workspace-entry?error=routing";

/**
 * Keep product navigation inside the verified workspace namespace. The base
 * is produced from the server's active-membership snapshot; an invalid base
 * fails closed to the original internal route instead of inventing a tenant.
 */
export function workspaceHref(base: string | undefined, href: string): string {
  if (!href.startsWith("/") || href.startsWith("//")) return WORKSPACE_ROUTING_FALLBACK;
  if (!base || !CANONICAL_WORKSPACE_BASE.test(base)) return WORKSPACE_ROUTING_FALLBACK;
  if (href === "/") return base;
  return `${base}${href}`;
}
