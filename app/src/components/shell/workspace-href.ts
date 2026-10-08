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

/**
 * Issue 857 — base 를 확인했을 때만 붙인다. 못 읽었으면 받은 주소 그대로 둔다(프록시가 회사 쿠키
 * 기준으로 보낸다) — 이동을 오류 화면으로 바꾸지 않는다. 이미 `/w/...` 인 주소는 다시 붙이지 않는다.
 */
export function withWorkspaceBase(base: string | null | undefined, href: string): string {
  if (!base || href.startsWith("/w/")) return href;
  return workspaceHref(base, href);
}

/**
 * 현재 주소에서 워크스페이스 뿌리(`/w/acme`)를 되읽는다.
 *
 * 클라이언트 부품이 다른 탭으로 보내는 링크를 만들 때 쓴다. 서버가 계산한 base 를
 * 화면 깊숙한 부품까지 프롭으로 꿰지 않으려는 것이고, 못 읽으면 null 을 줘서
 * 호출부가 «네임스페이스 없는 주소» 를 만들지 못하게 한다.
 */
export function workspaceBaseFromPathname(pathname: string): string | null {
  const match = /^(\/w\/[^/?#]+)/.exec(pathname);
  if (!match) return null;
  return CANONICAL_WORKSPACE_BASE.test(match[1]) ? match[1] : null;
}
