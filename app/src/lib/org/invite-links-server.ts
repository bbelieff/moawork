import type { SupabaseClient } from "@supabase/supabase-js";
import { isInviteRole, isInviteScope, type InviteRole, type InviteScope } from "@/lib/org/invite-links";

/**
 * 만들어 둔 링크 목록을 읽는다 — 148 의 list_org_invite_links.
 *
 * ★ 「못 읽음」과 「하나도 없음」을 «반드시» 나눈다.
 *   못 읽었는데 빈 목록을 그리면 화면이 「만든 링크가 없다」고 «단언» 하게 된다.
 *   그건 거짓말이고, 살아 있는 링크를 못 보게 만들어 끄지도 못하게 한다.
 */

export type InviteLinkJoined = { userId: string; at: string | null };

export type InviteLinkRow = {
  token: string;
  role: InviteRole;
  scope: InviteScope;
  expiresAt: string | null;
  maxUses: number | null;
  usedCount: number;
  revokedAt: string | null;
  createdAt: string | null;
  usable: boolean;
  joined: InviteLinkJoined[];
};

export type InviteLinkList =
  | { kind: "ready"; links: InviteLinkRow[] }
  | { kind: "unavailable" };

function parseJoined(value: unknown): InviteLinkJoined[] {
  if (!Array.isArray(value)) return [];
  const out: InviteLinkJoined[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.userId !== "string" || !row.userId) continue;
    out.push({ userId: row.userId, at: typeof row.at === "string" ? row.at : null });
  }
  return out;
}

export function parseInviteLinkList(value: unknown): InviteLinkList {
  if (!Array.isArray(value)) return { kind: "unavailable" };
  const links: InviteLinkRow[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.token !== "string" || !row.token) continue;
    if (!isInviteRole(row.role) || !isInviteScope(row.scope)) continue;
    links.push({
      token: row.token,
      role: row.role,
      scope: row.scope,
      expiresAt: typeof row.expiresAt === "string" ? row.expiresAt : null,
      maxUses: typeof row.maxUses === "number" ? row.maxUses : null,
      usedCount: typeof row.usedCount === "number" ? row.usedCount : 0,
      revokedAt: typeof row.revokedAt === "string" ? row.revokedAt : null,
      createdAt: typeof row.createdAt === "string" ? row.createdAt : null,
      usable: row.usable === true,
      joined: parseJoined(row.joined),
    });
  }
  return { kind: "ready", links };
}

export async function loadInviteLinks(
  orgId: string,
  makeClient: () => Promise<SupabaseClient>,
): Promise<InviteLinkList> {
  try {
    const supabase = await makeClient();
    const { data, error } = await supabase.rpc("list_org_invite_links", { p_org_id: orgId });
    // 대표·관리자가 아니면 42501 이 온다. 그때도 «못 읽음» 이다 — 빈 목록이 아니다.
    if (error) return { kind: "unavailable" };
    return parseInviteLinkList(data);
  } catch {
    return { kind: "unavailable" };
  }
}
