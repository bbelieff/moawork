import type { Ctx, MemberRole, MemberScope } from "@/lib/types";

export type AccountViewModel = {
  displayName: string;
  loginEmail: string;
  initial: string;
  workspaceName: string;
  roleLabel: string;
  roleDescription: string;
  scopeLabel: string;
  teamMessage: string;
  canManageCompany: boolean;
};

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "대표",
  admin: "관리자",
  team_lead: "팀장",
  member: "사원",
};

const SCOPE_LABELS: Record<MemberScope, string> = {
  all: "회사 업무 전체",
  department: "내 부서 이하",
  assigned: "내게 배정된 업무",
};

export function displayAccountName(name: string | null | undefined): string {
  const value = name?.trim();
  return value || "이름 미등록";
}

export function accountInitial(name: string | null | undefined): string {
  const value = name?.trim();
  return value ? Array.from(value)[0] : "나";
}

export function displayLoginEmail(email: string | null | undefined): string {
  const value = email?.trim();
  return value || "로그인 이메일이 연결되지 않았어요";
}

function membershipPresentation(ctx: Ctx): Pick<
  AccountViewModel,
  "roleLabel" | "roleDescription" | "scopeLabel" | "canManageCompany"
> {
  // ⚠ 과거에는 여기서 isPlatformAdmin 이면 역할을 "확인 중"으로 가렸다.
  // 그 방어는 "Platform role 이 workspace membership 을 덮어쓸 수 있다"는 전제였는데,
  // 그 전제는 해소됐다 — session.ts 의 **두 경로 모두** role/scope 를 검증된
  // org_members 행에서만 채우고(getSupabaseSession: membership.role,
  // getDevSession: membership.role), isPlatformAdmin 은 그와 독립된 별도 축이다.
  // 전제가 사라진 뒤에도 가림막이 남아 belie(오너 & 플랫폼 관리자)가 자기 회사에서
  // "회사 역할 확인 중" + 관리 불가로 고착됐다 → 실제 멤버십 역할을 그대로 쓴다.
  // (플랫폼 관리자라는 사실은 권한을 **더** 주는 축이지, 자기 역할을 가릴 이유가 아니다.)
  return {
    roleLabel: ROLE_LABELS[ctx.role],
    roleDescription: `${ROLE_LABELS[ctx.role]}로 참여하고 있어요.`,
    scopeLabel: SCOPE_LABELS[ctx.scope],
    canManageCompany: ctx.role === "owner",
  };
}

export function buildAccountViewModel(ctx: Ctx): AccountViewModel {
  const membership = membershipPresentation(ctx);
  return {
    displayName: displayAccountName(ctx.user.name),
    loginEmail: displayLoginEmail(ctx.user.email),
    initial: accountInitial(ctx.user.name),
    workspaceName: ctx.org.name,
    teamMessage:
      ctx.role === "owner" && !ctx.isPlatformAdmin
        ? "아직 만든 팀이 없어요. 사람이 늘면 회사 관리에서 팀을 만들 수 있어요."
        : "아직 소속 팀이 없어요. 회사 정보는 계속 볼 수 있어요. 팀 배정이 필요하면 대표에게 알려 주세요.",
    ...membership,
  };
}
