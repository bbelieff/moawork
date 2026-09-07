import type { Ctx } from "@/lib/types";
import { roleLabel, scopeLabel } from "@/lib/auth/roles";
import { euroRo } from "@/lib/text/josa";

export type AccountViewModel = {
  displayName: string;
  loginEmail: string;
  initial: string;
  workspaceName: string;
  roleLabel: string;
  roleDescription: string;
  scopeLabel: string;
  canManageCompany: boolean;
  scopeNote: string | null;
};

export type ProfileReadState =
  | Readonly<{ kind: "ready"; value: string }>
  | Readonly<{ kind: "empty"; message: string }>
  | Readonly<{ kind: "error"; message: string }>;

export type AccountOrgProfile = Readonly<{
  title: ProfileReadState;
  department: ProfileReadState;
  job: ProfileReadState;
  reportsTo: ProfileReadState;
}>;

// ★ 이름표는 lib/auth/roles.ts 하나에서 온다. 여기 적으면 그날부터 어긋나기 시작한다.

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
  "roleLabel" | "roleDescription" | "scopeLabel" | "canManageCompany" | "scopeNote"
> {
  // ⚠ 과거에는 여기서 isPlatformAdmin 이면 역할을 "확인 중"으로 가렸다.
  // 그 방어는 "Platform role 이 workspace membership 을 덮어쓸 수 있다"는 전제였는데,
  // 그 전제는 해소됐다 — session.ts 의 **두 경로 모두** role/scope 를 검증된
  // org_members 행에서만 채우고(getSupabaseSession: membership.role,
  // getDevSession: membership.role), isPlatformAdmin 은 그와 독립된 별도 축이다.
  // 전제가 사라진 뒤에도 가림막이 남아 belie(오너 & 플랫폼 관리자)가 자기 회사에서
  // "회사 역할 확인 중" + 관리 불가로 고착됐다 → 실제 멤버십 역할을 그대로 쓴다.
  // (플랫폼 관리자라는 사실은 권한을 **더** 주는 축이지, 자기 역할을 가릴 이유가 아니다.)
  /*
   * ★ 조사를 손으로 적지 않는다 — 이름이 받침으로 끝나면 「로」가 아니라 「으로」다.
   *   전에는 `${roleLabel(ctx.role)}로` 였고, 네 역할 중 «둘» 이 이렇게 보였다:
   *       팀장 → 「팀장로 참여하고 있어요」 · 구성원 → 「구성원로 참여하고 있어요」
   *   #699 가 「사원」을 「구성원」으로 바꿨지만 둘 다 받침이라 계속 깨진 채였다.
   *   이름을 고치는 것만으로는 안 되고, 조사가 이름을 «따라와야» 한다 (#700).
   */
  const role = roleLabel(ctx.role);
  return {
    roleLabel: role,
    roleDescription: `${role}${euroRo(role)} 참여하고 있어요.`,
    scopeLabel: scopeLabel(ctx.scope),
    canManageCompany: ctx.role === "owner",
    scopeNote:
      ctx.scope === "department"
        ? "이 값은 회사의 권한 설정이에요. 일부 화면의 부서 범위 적용은 계속 보강 중이에요."
        : null,
  };
}

export function buildAccountViewModel(ctx: Ctx): AccountViewModel {
  const membership = membershipPresentation(ctx);
  return {
    displayName: displayAccountName(ctx.user.name),
    loginEmail: displayLoginEmail(ctx.user.email),
    initial: accountInitial(ctx.user.name),
    workspaceName: ctx.org.name,
    ...membership,
  };
}
