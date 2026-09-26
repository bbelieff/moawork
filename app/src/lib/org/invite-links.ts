import { safeNextPath } from "@/lib/auth/oauth";

/**
 * 「사람 부르기」 링크 — 화면 셋이 함께 쓰는 «말» 을 여기 모은다.
 *
 * ★ 판정은 전부 DB 가 한다(147 · 148). 이 파일은 «DB 가 한 말을 화면 말로 옮기는» 일만 한다.
 *   여기서 권한을 판단하거나 링크를 만들어 내면, 화면이 서버보다 관대해지는 순간이 온다.
 */

/** 링크로 줄 수 있는 자리. 대표는 «링크로 못 준다» — 148 이 22023 으로 막는다. */
export const INVITE_ROLES = ["admin", "team_lead", "member"] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

export const INVITE_SCOPES = ["all", "department", "assigned"] as const;
export type InviteScope = (typeof INVITE_SCOPES)[number];

export function isInviteRole(value: unknown): value is InviteRole {
  return typeof value === "string" && (INVITE_ROLES as readonly string[]).includes(value);
}

export function isInviteScope(value: unknown): value is InviteScope {
  return typeof value === "string" && (INVITE_SCOPES as readonly string[]).includes(value);
}

/**
 * ★ 토큰 모양. 147 이 만드는 것은 «16바이트 base64 에서 +/= 를 ab 로 바꾼» 24글자다.
 *   그래서 항상 [A-Za-z0-9] 다. 여기서는 넉넉히 받되 «그 바깥은 링크가 아니다» 로 자른다 —
 *   경로에 아무 문자열이나 들어와 DB 까지 가는 것을 막는다.
 */
const TOKEN_SHAPE = /^[A-Za-z0-9]{10,64}$/u;

export function isInviteToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_SHAPE.test(value);
}

/** 링크가 가리키는 화면. 한 군데서만 만든다 — 두 군데서 만들면 언젠가 갈라진다. */
export function inviteJoinPath(token: string): string {
  return `/join/${token}`;
}

/**
 * ★ 로그인하고 «돌아올» 자리.
 *
 *   로그아웃 상태로 링크를 누르면 구글 로그인을 거쳐야 하는데, 그 사이에 토큰을 잃으면
 *   그 사람은 초대받은 줄도 모르고 「신청하세요」 화면에 떨어진다. 그래서 next 로 들고 간다.
 *
 *   ★ 여기서 «모양까지» 검사한다. 콜백은 이 함수가 null 을 주면 평소 길로 보낸다 —
 *     즉 이 함수가 열어 주는 문 하나 말고는 /join 으로 못 간다.
 */
export function joinTargetFromNext(value: unknown): string | null {
  const safe = safeNextPath(value, "");
  if (!safe) return null;
  const match = /^\/join\/([^/?#]+)$/u.exec(safe);
  if (!match) return null;
  return isInviteToken(match[1]) ? safe : null;
}

/** 미리보기 — 로그인 «전» 에도 부른다. 회사 이름과 자리 말고는 안 나온다(147 peek). */
export type InvitePeek =
  | { kind: "usable"; orgName: string; role: InviteRole; scope: InviteScope }
  | { kind: "unusable" };

export function parseInvitePeek(value: unknown): InvitePeek {
  if (!value || typeof value !== "object") return { kind: "unusable" };
  const row = value as Record<string, unknown>;
  if (row.ok !== true) return { kind: "unusable" };
  const { name, role, scope } = row;
  if (typeof name !== "string" || !name) return { kind: "unusable" };
  if (!isInviteRole(role) || !isInviteScope(scope)) return { kind: "unusable" };
  return { kind: "usable", orgName: name, role, scope };
}

/**
 * 들어가기 결과.
 *
 * ★ 「이미 이 회사 사람이다」와 「방금 들어왔다」를 나눈다 — 화면이 할 말이 다르기 때문이다.
 *   나갔던 사람(needs_approval)도 따로 둔다. 그 사람에게 「링크가 죽었다」고 하면 거짓말이다.
 */
export type InviteRedeemOutcome =
  | { kind: "joined"; slug: string; orgName: string }
  | { kind: "already"; slug: string; orgName: string }
  | { kind: "needs_approval"; orgName: string | null }
  | { kind: "unusable" };

export function parseInviteRedeem(value: unknown): InviteRedeemOutcome {
  if (!value || typeof value !== "object") return { kind: "unusable" };
  const row = value as Record<string, unknown>;
  const orgName = typeof row.name === "string" && row.name ? row.name : null;

  if (row.ok !== true) {
    // 148 은 «나갔던 사람» 에게만 다른 이유를 준다. 나머지는 전부 한 말이다.
    return row.reason === "needs_approval" ? { kind: "needs_approval", orgName } : { kind: "unusable" };
  }

  const slug = typeof row.slug === "string" && row.slug ? row.slug : null;
  if (!slug || !orgName) return { kind: "unusable" };
  return { kind: row.already === true ? "already" : "joined", slug, orgName };
}

/** 들어간 뒤 갈 곳. 회사 주소는 /w/<슬러그> 다. */
export function workspacePath(slug: string): string {
  return `/w/${slug}`;
}

export function inviteRoleLabel(role: InviteRole): string {
  return role === "admin" ? "관리자" : role === "team_lead" ? "팀장" : "구성원";
}

export function inviteScopeLabel(scope: InviteScope): string {
  return scope === "all" ? "회사 전체" : scope === "department" ? "내 부서 이하" : "배정된 것만";
}

/**
 * ★ 만들기 규칙 — 화면이 서버보다 «관대하지» 않게 여기서 한 번 더 잰다.
 *   서버(148)가 진짜 관문이다. 여기서 막는 것은 「눌렀는데 빨간 글씨가 뜨는」 경험을 줄이기 위한 것이다.
 */
export const INVITE_MAX_USES_LIMIT = 1000;
export const INVITE_MAX_DAYS = 365;

export type InviteCreateInput = { role: InviteRole; scope: InviteScope; days: number | null; maxUses: number | null };
export type InviteCreateProblem =
  | "role"
  | "scope"
  | "needs_expiry_or_limit"
  | "days_range"
  | "uses_range";

export function checkInviteCreate(input: InviteCreateInput): InviteCreateProblem | null {
  if (!isInviteRole(input.role)) return "role";
  if (!isInviteScope(input.scope)) return "scope";
  // 148 ② — 기한과 횟수를 «둘 다» 비우면 끄기 전까지 영원히 사는 열쇠가 된다.
  if (input.days === null && input.maxUses === null) return "needs_expiry_or_limit";
  if (input.days !== null && (!Number.isInteger(input.days) || input.days <= 0 || input.days > INVITE_MAX_DAYS)) return "days_range";
  if (input.maxUses !== null && (!Number.isInteger(input.maxUses) || input.maxUses <= 0 || input.maxUses > INVITE_MAX_USES_LIMIT)) return "uses_range";
  return null;
}

/*
 * ★ 화면과 서버 액션이 주고받는 «상태» 는 여기 둔다.
 *   Next 16 의 "use server" 파일은 async 함수만 export 할 수 있어서,
 *   상수·타입을 액션 파일에 두면 게이트가 막는다(check-use-server-exports).
 */
export type JoinActionState =
  | { kind: "idle" }
  | { kind: "unusable" }
  | { kind: "needs_approval"; orgName: string | null }
  | { kind: "signed_out" }
  | { kind: "error" };

export const JOIN_IDLE: JoinActionState = { kind: "idle" };

export type InviteActionState =
  | { kind: "idle" }
  | { kind: "created"; token: string }
  | { kind: "revoked" }
  | { kind: "error"; message: string };

export const INVITE_IDLE: InviteActionState = { kind: "idle" };

export function inviteCreateProblemMessage(problem: InviteCreateProblem): string {
  switch (problem) {
    case "needs_expiry_or_limit":
      return "며칠 뒤 만료할지, 몇 명까지 받을지 — 둘 중 하나는 정해 주세요. 둘 다 비우면 끄기 전까지 계속 살아 있는 링크가 돼요.";
    case "days_range":
      return `기간은 1일에서 ${INVITE_MAX_DAYS}일 사이로 정해 주세요.`;
    case "uses_range":
      return `받을 사람 수는 1명에서 ${INVITE_MAX_USES_LIMIT}명 사이로 정해 주세요.`;
    default:
      return "고른 값이 올바르지 않아요. 다시 선택해 주세요.";
  }
}
