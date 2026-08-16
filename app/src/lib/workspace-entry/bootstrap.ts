import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureDefaultTabs } from "@/lib/default-tabs";
import { SupabaseBoardsRepo } from "@/lib/repo/supabase/boardsRepo";
import type { Ctx, MemberRole, MemberScope, Org, User } from "@/lib/types";

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function role(value: unknown): MemberRole | null {
  return value === "owner" || value === "admin" || value === "team_lead" || value === "member" ? value : null;
}

function scope(value: unknown): MemberScope | null {
  return value === "all" || value === "department" || value === "assigned" ? value : null;
}

/** Ensures the approved workspace product structure using the same authenticated request client. */
export async function bootstrapApprovedWorkspace(client: SupabaseClient, slug: string): Promise<void> {
  const [{ data: auth }, orgResult] = await Promise.all([
    client.auth.getUser(),
    client.from("orgs").select("id,name,plan_tier,created_at").eq("slug", slug).maybeSingle(),
  ]);
  const authUser = auth.user;
  const orgRow = orgResult.data as Row | null;
  if (!authUser || orgResult.error || !orgRow) throw new Error("workspace bootstrap context unavailable");

  const orgId = text(orgRow.id);
  if (!orgId) throw new Error("workspace bootstrap context unavailable");
  const membershipResult = await client
    .from("org_members")
    .select("role,scope,status")
    .eq("org_id", orgId)
    .eq("user_id", authUser.id)
    .eq("status", "active")
    .maybeSingle();
  const membership = membershipResult.data as Row | null;
  const memberRole = role(membership?.role);
  const memberScope = scope(membership?.scope);
  if (membershipResult.error || !membership || !memberRole || !memberScope) {
    throw new Error("workspace bootstrap membership unavailable");
  }

  const user: User = {
    id: authUser.id,
    email: authUser.email ?? null,
    name: text(authUser.user_metadata?.name) ?? text(authUser.user_metadata?.full_name) ?? authUser.email ?? null,
    avatar_url: text(authUser.user_metadata?.avatar_url),
    created_at: authUser.created_at,
  };
  const org: Org = {
    id: orgId,
    name: text(orgRow.name) ?? slug,
    plan_tier: text(orgRow.plan_tier) ?? "free",
    created_at: text(orgRow.created_at) ?? new Date(0).toISOString(),
  };
  const ctx: Ctx = { user, org, role: memberRole, scope: memberScope };
  await ensureDefaultTabs(
    ctx,
    new SupabaseBoardsRepo(client),
    [{ userId: user.id, displayName: user.name?.trim() || user.email?.trim() || "멤버" }],
  );
}
