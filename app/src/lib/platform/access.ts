// T07 · 플랫폼 콘솔 접근 판정 + 민감정보 마스킹(순수 함수).
//
// 판정 원칙:
//   · `app_admins` 를 직접 select 하지 않는다 — RLS 로 막혀 있어 0건이 나온다.
//     반드시 SECURITY DEFINER 함수(`platform_admin_level` / `app_admin_role`) 경유.
//   · 조회는 3등급(super/operator/viewer) 동일하게 허용하고, **실행(쓰기)만** 등급으로 가른다.
//   · 클라이언트 가드는 신뢰하지 않는다 — 서버(RPC)에서도 같은 판정이 강제된다(014 §8).

import { ADMIN_LEVEL_RANK, type AdminLevel } from "./types";

/** 임의 값을 AdminLevel 로 좁힌다. 알 수 없는 값은 null. */
export function parseAdminLevel(value: unknown): AdminLevel | null {
  return value === "super" || value === "operator" || value === "viewer" ? value : null;
}

/**
 * 등급 충족 여부 — 014 `platform_admin_at_least()` 와 **같은 규칙**이어야 한다.
 * 한쪽만 바꾸면 화면과 서버 판정이 어긋난다.
 */
export function atLeast(
  actual: AdminLevel | null,
  required: AdminLevel,
): boolean {
  if (!actual) return false;
  return ADMIN_LEVEL_RANK[actual] >= ADMIN_LEVEL_RANK[required];
}

/** 콘솔 진입 가능 여부 — 등급 무관, 관리자이기만 하면 조회 가능. */
export function canEnterConsole(level: AdminLevel | null): boolean {
  return level !== null;
}

/** 화면별 실행 권한. 조회는 전원 가능하므로 여기 없는 것은 전부 허용이다. */
export const PLATFORM_ACTIONS = {
  /** 가입 요청 승인/거절 */
  resolveRequest: "operator",
  /** 내부 조직 토글 */
  setOrgInternal: "operator",
  /** 운영자 등급 편집·회수 */
  manageAdmins: "super",
  /** 결제·매출 내보내기 */
  exportBilling: "operator",
} as const satisfies Record<string, AdminLevel>;

export type PlatformAction = keyof typeof PLATFORM_ACTIONS;

/** 특정 실행을 할 수 있는가. */
export function can(level: AdminLevel | null, action: PlatformAction): boolean {
  return atLeast(level, PLATFORM_ACTIONS[action]);
}

// ── 어깨너머 방지 마스킹 ────────────────────────────────────────────
//
// 계약 상대(고객사 대표) 정보는 운영 업무상 필요하지만, 화면에 상시 노출하면
// 어깨너머로 읽힌다. 기본은 마스킹하고 [전체보기] 1클릭으로 펼친다.
// ⚠ 마스킹은 **표시 계층**이다. 원본을 서버에서 안 주는 것이 아니라 가리는 것이므로,
//   진짜 비공개가 필요한 값은 애초에 조회하지 않는 쪽이 맞다(P0 의 고객 업무 데이터처럼).

/** 값 없음 표시. */
export const EMPTY = "—";

/**
 * 전화번호 마스킹 — 앞 3자리와 끝 4자리만 남긴다.
 * `010-1234-5678` → `010-****-5678`
 */
export function maskPhone(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7) return "*".repeat(Math.max(digits.length, 1));
  const head = digits.slice(0, 3);
  const tail = digits.slice(-4);
  return `${head}-****-${tail}`;
}

/**
 * 사업자등록번호 마스킹 — 앞 3자리만 남긴다.
 * `123-45-67890` → `123-**-*****`
 */
export function maskBizRegNo(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "*".repeat(Math.max(digits.length, 1));
  return `${digits.slice(0, 3)}-**-*****`;
}

/**
 * 이메일 마스킹 — 로컬파트 첫 글자만 남긴다.
 * `beliefkimkim@gmail.com` → `b***@gmail.com`
 */
export function maskEmail(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const at = value.indexOf("@");
  if (at <= 0) return "*".repeat(value.length);
  return `${value[0]}***${value.slice(at)}`;
}

/** 이름 마스킹 — 가운데 글자를 가린다. `홍길동` → `홍*동` */
export function maskName(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const v = value.trim();
  if (v.length <= 1) return v;
  if (v.length === 2) return `${v[0]}*`;
  return `${v[0]}${"*".repeat(v.length - 2)}${v.at(-1)}`;
}

// ── 고객 데이터 열람 게이트 ─────────────────────────────────────────

/** 고객사 상세에서 열람을 시도할 수 있는 데이터 종류. */
export type CustomerDataKind = "contract" | "customerRecords" | "hometax";

export interface DataAccessDecision {
  allowed: boolean;
  /** 권한이 있으면 열람 가능한가(별도 승인 필요 여부). */
  requiresGrant: boolean;
  reason: string;
}

/**
 * 고객사 상세의 데이터 종류별 열람 판정.
 *
 * P0 고정 규칙:
 *   · `contract`         — 계약 상대 정보. 운영자면 열람 가능(마스킹 표시).
 *   · `customerRecords`  — 고객의 고객(업체 8,400건). **별도 열람 권한 필요** → P0 차단.
 *   · `hometax`          — 홈택스 연동 데이터. **항상 차단**(등급 무관, 예외 없음).
 *
 * break-glass(승인 후 실제 열람)는 P0 범위 밖이다. 여기서는 항상 차단하고
 * 화면은 "권한 필요"로만 안내한다.
 */
export function decideDataAccess(
  level: AdminLevel | null,
  kind: CustomerDataKind,
): DataAccessDecision {
  if (kind === "hometax") {
    // 등급을 보지 않는다 — super 라도 차단이다.
    return {
      allowed: false,
      requiresGrant: false,
      reason: "홈택스 연동 데이터는 플랫폼 운영자에게 공개되지 않습니다.",
    };
  }
  if (!canEnterConsole(level)) {
    return { allowed: false, requiresGrant: false, reason: "운영 권한이 없습니다." };
  }
  if (kind === "customerRecords") {
    return {
      allowed: false,
      requiresGrant: true,
      reason: "고객사의 업무 데이터는 별도 열람 권한이 승인된 뒤에만 볼 수 있습니다.",
    };
  }
  return { allowed: true, requiresGrant: false, reason: "계약 상대 정보입니다." };
}
