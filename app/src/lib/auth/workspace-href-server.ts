import { workspaceHref } from "@/components/shell/workspace-href";
import { getSession } from "@/lib/auth/session";
import { loadWorkspaceRoutingSnapshot } from "@/lib/auth/workspace-entry-server";

export async function loadVerifiedWorkspaceBasePath(): Promise<string | undefined> {
  const [ctx, routing] = await Promise.all([getSession(), loadWorkspaceRoutingSnapshot()]);
  if (routing.kind !== "ready") return undefined;
  const matches = routing.memberships.filter((membership) => membership.orgId === ctx.org.id);
  return matches.length === 1 ? `/w/${matches[0].slug}` : undefined;
}

/**
 * Issue 857 — 기본 탭 경유지(/newcust 등)가 점검과 «동시에» 출발시켜 두는 base 경로.
 *   경유지가 `/boards/<id>` 로만 보내면 프록시가 `/w/<slug>/boards/<id>` 로 한 번 더 튕긴다(307 →
 *   서버 왕복 한 벌). base 를 붙여 보내면 그 한 번이 없어진다. 점검(약 1초)과 겹치므로 기다림이 늘지 않는다.
 *   못 읽으면 base 없이(= 전과 같은 주소) 보낸다 — 이동 자체를 막지 않는다.
 */
export function startVerifiedWorkspaceBasePath(): Promise<string | undefined> {
  return loadVerifiedWorkspaceBasePath().catch(() => undefined);
}

export async function workspaceServerHref(href: string): Promise<string> {
  return workspaceHref(await loadVerifiedWorkspaceBasePath(), href);
}
