import "server-only";

import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { loadMemberOrgSummary } from "@/lib/auth/member-org-summary";
import type { Ctx } from "@/lib/types";
import { buildOrgChart, type OrgChartState } from "./chart";

export type { OrgChartState, OrgDepartmentView, OrgPersonView } from "./chart";

/**
 * 조직도 조회 — 013 의 예외 테이블(§1-3 ①)까지 함께 읽어 §1-3 규칙으로 계산한다
 * (뷰모델 조립은 순수 함수 `buildOrgChart` 가 맡는다 — chart.ts).
 * 대표만 편집 가능(기존 MemberOrganizationChart 와 같은 권한 경계).
 */
export async function loadOrgChart(ctx: Ctx): Promise<OrgChartState> {
  if (!hasSupabaseEnv()) return { kind: "unavailable" };

  const summary = await loadMemberOrgSummary(ctx);
  if (summary.kind !== "ready") return summary.kind === "unavailable" ? { kind: "unavailable" } : { kind: "error" };
  const allMembers = [summary.owner, ...summary.admins, ...summary.members];

  const supabase = await createClient();
  const [departmentsResult, membershipsResult, exceptionsResult] = await Promise.all([
    supabase.from("departments").select("id, parent_id, name, key, head_user_id, archived_at").eq("org_id", ctx.org.id),
    supabase.from("department_members").select("dept_id, user_id, is_primary").eq("org_id", ctx.org.id),
    supabase.from("member_hierarchy_assignments").select("member_user_id, reports_to_user_id").eq("org_id", ctx.org.id),
  ]);
  if (departmentsResult.error || membershipsResult.error || exceptionsResult.error) return { kind: "error" };

  return buildOrgChart(
    summary.owner.userId,
    allMembers,
    departmentsResult.data ?? [],
    membershipsResult.data ?? [],
    exceptionsResult.data ?? [],
    ctx.role === "owner",
  );
}
