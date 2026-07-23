import type { Ctx, MemberRole, MemberScope } from "@/lib/types";

export type AccountViewModel = {
  displayName: string;
  maskedEmail: string;
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
  admin: "팀장",
  member: "사원",
};

const SCOPE_LABELS: Record<MemberScope, string> = {
  all: "회사 업무 전체",
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

export function maskLoginEmail(email: string | null | undefined): string {
  const value = email?.trim();
  if (!value) return "로그인 이메일이 연결되지 않았어요";

  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) {
    return "로그인 이메일을 안전하게 표시할 수 없어요";
  }

  const local = Array.from(value.slice(0, at));
  const visible = local.slice(0, Math.min(2, local.length)).join("");
  return `${visible}***${value.slice(at)}`;
}

function membershipPresentation(ctx: Ctx): Pick<
  AccountViewModel,
  "roleLabel" | "roleDescription" | "scopeLabel" | "canManageCompany"
> {
  // 현재 Ctx는 Platform role이 Workspace membership을 덮어쓸 수 있다.
  // strict-app 계약 전에는 그 값을 고객사 역할로 추정해 보여주지 않는다.
  if (ctx.isPlatformAdmin) {
    return {
      roleLabel: "회사 역할 확인 중",
      roleDescription: "회사 역할을 안전하게 확인하는 기능을 준비하고 있어요.",
      scopeLabel: "회사 소속 범위를 확인 중이에요",
      canManageCompany: false,
    };
  }

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
    maskedEmail: maskLoginEmail(ctx.user.email),
    initial: accountInitial(ctx.user.name),
    workspaceName: ctx.org.name,
    teamMessage:
      ctx.role === "owner" && !ctx.isPlatformAdmin
        ? "아직 만든 팀이 없어요. 사람이 늘면 회사 관리에서 팀을 만들 수 있어요."
        : "아직 소속 팀이 없어요. 회사 정보는 계속 볼 수 있어요. 팀 배정이 필요하면 대표에게 알려 주세요.",
    ...membership,
  };
}
