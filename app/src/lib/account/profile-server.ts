import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/lib/types";
import {
  loadMemberOrgSummaryWithClient,
  type MemberOrgSummary,
  type MemberSummaryRow,
} from "@/lib/auth/member-org-summary";
import { loadOrgChart, type OrgChart } from "@/lib/org/departments";
import { selectOrgViewModel } from "@/lib/org/org-view";
import { loadReportingExceptions } from "@/lib/org/reporting-exceptions";
import {
  loadSeatDefinitions,
  type SeatDefinition,
} from "@/lib/org/seat-definitions";
import { seatKeyToId } from "@/lib/org/seats";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { AccountOrgProfile, ProfileReadState } from "./presentation";

type ProfileSources = Readonly<{
  summary: MemberOrgSummary;
  chart: OrgChart;
  exceptions: ReadonlyMap<string, string | null> | null;
  definitions: ReadonlyMap<string, SeatDefinition> | null;
}>;

const errorState = (message: string): ProfileReadState => ({ kind: "error", message });
const emptyState = (message: string): ProfileReadState => ({ kind: "empty", message });
const readyState = (value: string): ProfileReadState => ({ kind: "ready", value });

function allMembers(summary: Extract<MemberOrgSummary, { kind: "ready" }>): MemberSummaryRow[] {
  return [summary.owner, ...summary.admins, ...summary.members];
}

/**
 * AccountHub가 이미 존재하는 조직 정본들을 한 화면용 읽기 모델로만 조합한다.
 * 이 함수는 값을 추측하지 않는다. 비어 있음과 읽기 실패를 서로 다른 상태로 보존한다.
 */
export function buildAccountOrgProfile(ctx: Ctx, sources: ProfileSources): AccountOrgProfile {
  const member = sources.summary.kind === "ready"
    ? allMembers(sources.summary).find(
        (row) => row.orgId === ctx.org.id && row.userId === ctx.user.id,
      ) ?? null
    : null;
  const chartMember = sources.chart.kind === "ready"
    ? sources.chart.members.find((row) => row.userId === ctx.user.id) ?? null
    : null;
  const primaryDepartment = sources.chart.kind === "ready" && chartMember?.primaryDepartmentId
    ? sources.chart.departments.find((row) => row.id === chartMember.primaryDepartmentId) ?? null
    : null;

  const title = sources.summary.kind !== "ready" || !member
    ? errorState("호칭을 확인하지 못했어요.")
    : member.title
      ? readyState(member.title)
      : emptyState("아직 호칭이 정해지지 않았어요.");

  const department = sources.chart.kind !== "ready" || !chartMember
    ? errorState("소속 부서를 확인하지 못했어요.")
    : primaryDepartment
      ? readyState(primaryDepartment.name)
      : chartMember.primaryDepartmentId
        ? errorState("소속 부서의 이름을 확인하지 못했어요.")
        : emptyState("아직 주부서가 정해지지 않았어요.");

  let job: ProfileReadState;
  if (sources.chart.kind !== "ready" || !chartMember || sources.definitions === null) {
    job = errorState("직무 안내를 확인하지 못했어요.");
  } else {
    const definition = sources.definitions.get(seatKeyToId({
      departmentId: chartMember.primaryDepartmentId,
      role: ctx.role,
    }));
    const summary = definition?.summary?.trim();
    job = summary
      ? readyState(summary)
      : emptyState("현재 자리의 직무 안내가 아직 작성되지 않았어요.");
  }

  let reportsTo: ProfileReadState;
  const orgView = selectOrgViewModel({
    chart: sources.chart,
    summary: sources.summary,
    exceptions: sources.exceptions,
  });
  const current = orgView?.members.find((row) => row.userId === ctx.user.id) ?? null;
  if (!orgView || !current || !orgView.reportingKnown) {
    reportsTo = errorState("보고 대상을 확인하지 못했어요.");
  } else if (current.reportsToUserId === null) {
    reportsTo = emptyState("이 회사의 최상위 보고 위치예요.");
  } else if (!current.reportsToName) {
    reportsTo = errorState("보고 대상의 이름을 확인하지 못했어요.");
  } else {
    reportsTo = readyState(current.reportsToName);
  }

  return { title, department, job, reportsTo };
}

export type AccountProfileDependencies = Readonly<{
  getClient: () => Promise<SupabaseClient>;
  loadSummary: (client: SupabaseClient, ctx: Ctx) => Promise<MemberOrgSummary>;
  loadChart: (ctx: Ctx, clientFactory: () => Promise<SupabaseClient>) => Promise<OrgChart>;
  loadExceptions: (
    ctx: Ctx,
    clientFactory: () => Promise<SupabaseClient>,
  ) => Promise<Map<string, string | null> | null>;
  loadDefinitions: (
    ctx: Ctx,
    clientFactory: () => Promise<SupabaseClient>,
  ) => Promise<Map<string, SeatDefinition> | null>;
}>;

const defaultDependencies: AccountProfileDependencies = {
  getClient: createClient,
  loadSummary: loadMemberOrgSummaryWithClient,
  loadChart: loadOrgChart,
  loadExceptions: loadReportingExceptions,
  loadDefinitions: loadSeatDefinitions,
};

export async function loadAccountOrgProfileWithDependencies(
  ctx: Ctx,
  dependencies: AccountProfileDependencies,
): Promise<AccountOrgProfile> {
  try {
    const client = await dependencies.getClient();
    const clientFactory = async () => client;
    const [summary, chart, exceptions, definitions] = await Promise.all([
      dependencies.loadSummary(client, ctx),
      dependencies.loadChart(ctx, clientFactory),
      dependencies.loadExceptions(ctx, clientFactory),
      dependencies.loadDefinitions(ctx, clientFactory),
    ]);
    return buildAccountOrgProfile(ctx, { summary, chart, exceptions, definitions });
  } catch {
    return {
      title: errorState("호칭을 확인하지 못했어요."),
      department: errorState("소속 부서를 확인하지 못했어요."),
      job: errorState("직무 안내를 확인하지 못했어요."),
      reportsTo: errorState("보고 대상을 확인하지 못했어요."),
    };
  }
}

export async function loadAccountOrgProfile(ctx: Ctx): Promise<AccountOrgProfile> {
  if (!hasSupabaseEnv()) {
    return {
      title: errorState("호칭을 확인하지 못했어요."),
      department: errorState("소속 부서를 확인하지 못했어요."),
      job: errorState("직무 안내를 확인하지 못했어요."),
      reportsTo: errorState("보고 대상을 확인하지 못했어요."),
    };
  }
  return loadAccountOrgProfileWithDependencies(ctx, defaultDependencies);
}
