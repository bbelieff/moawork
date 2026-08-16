const CANONICAL_WORKSPACE_BASE = /^\/w\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Keep product navigation inside the verified workspace namespace. The base
 * is produced from the server's active-membership snapshot; an invalid base
 * fails closed to the original internal route instead of inventing a tenant.
 */
export function workspaceHref(base: string | undefined, href: string): string {
  if (!base || !CANONICAL_WORKSPACE_BASE.test(base)) return href;
  if (href === "/") return base;
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  return `${base}${href}`;
}
