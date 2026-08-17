// BBE-199 회사 로고 — 화면·액션·DB 가 공유하는 계약.
//
// ★ 실패 사유를 «하나로 뭉개지 않는다». BBE-193 의 교훈: 성공·실패 표현이
//   판정 근거를 안 읽으면 그게 결함이다. 사유마다 다른 문구를 돌려준다.

export const ORG_LOGO_BUCKET = "org-logos";

/** 1 MiB. supabase/migrations/098_bbe199_org_logo.sql 의 file_size_limit·CHECK 와 같은 값이어야 한다. */
export const ORG_LOGO_MAX_BYTES = 1048576;

export const ORG_LOGO_ALLOWED_MIME = ["image/png", "image/jpeg", "image/svg+xml"] as const;

export type OrgLogoMime = (typeof ORG_LOGO_ALLOWED_MIME)[number];

const EXTENSION: Record<OrgLogoMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
};

export type OrgLogoFailureReason =
  | "permission"
  | "empty"
  | "bad_format"
  | "too_large"
  | "upload_failed"
  | "unavailable";

export type OrgLogoValidation =
  | { ok: true; mime: OrgLogoMime }
  | { ok: false; reason: Extract<OrgLogoFailureReason, "empty" | "bad_format" | "too_large"> };

export function isOrgLogoMime(value: unknown): value is OrgLogoMime {
  return typeof value === "string" && (ORG_LOGO_ALLOWED_MIME as readonly string[]).includes(value);
}

/**
 * 서버가 파일을 받아들일지 판정한다.
 *
 * 화면에도 accept·크기 안내가 있지만 그것은 «안내» 다. 관문은 여기와 RPC 와 DB 제약이다.
 */
export function validateOrgLogoUpload(input: { mime: string; bytes: number }): OrgLogoValidation {
  if (!Number.isFinite(input.bytes) || input.bytes <= 0) return { ok: false, reason: "empty" };
  // 형식을 용량보다 먼저 본다 — 「크고 형식도 틀린」 파일은 형식 문제로 부르는 편이 고치기 쉽다.
  if (!isOrgLogoMime(input.mime)) return { ok: false, reason: "bad_format" };
  if (input.bytes > ORG_LOGO_MAX_BYTES) return { ok: false, reason: "too_large" };
  return { ok: true, mime: input.mime };
}

/**
 * 오브젝트 경로를 «서버가» 조립한다. 클라이언트가 경로를 정하지 못하게 하는 것이 핵심이다.
 * 첫 폴더가 org_id 여야 Storage RLS 와 RPC 와 DB CHECK 를 모두 통과한다.
 */
export function orgLogoObjectPath(orgId: string, mime: OrgLogoMime, token: string): string {
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u.test(orgId)) {
    throw new Error("org logo path requires a uuid org id");
  }
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(token)) {
    throw new Error("org logo path requires a safe token");
  }
  return `${orgId}/${token}.${EXTENSION[mime]}`;
}

const MESSAGE: Record<OrgLogoFailureReason, string> = {
  permission: "회사 로고는 대표와 관리자만 바꿀 수 있어요.",
  empty: "파일을 선택해 주세요.",
  bad_format: "PNG · JPG · SVG 파일만 올릴 수 있어요.",
  too_large: "파일이 너무 커요. 1MB 이하로 올려 주세요.",
  upload_failed: "파일을 올리지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  unavailable: "회사 로고를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
};

export function orgLogoFailureMessage(reason: OrgLogoFailureReason): string {
  return MESSAGE[reason];
}

/**
 * RPC 오류를 사유로 되돌린다.
 * 42501 = 권한 없음. 22023 은 098 이 형식·용량·경로를 각각 다른 message 로 던진다.
 * 그 밖은 «장애» 다 — 권한 문제로 위장하지 않는다 (lib/perm/server.ts 의 BBE-90 규약과 같은 결).
 */
export function orgLogoReasonFromRpcError(
  error: { code?: string | null; message?: string | null } | null | undefined,
): OrgLogoFailureReason {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  if (code === "42501") return "permission";
  if (message.includes("org logo format rejected")) return "bad_format";
  if (message.includes("org logo size rejected")) return "too_large";
  if (message.includes("org logo denied")) return "permission";
  return "unavailable";
}
