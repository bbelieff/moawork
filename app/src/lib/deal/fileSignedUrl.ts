/**
 * 딜 첨부파일 서명 다운로드 URL (BBE-16).
 *
 * "만료 서명 URL" 요건: HMAC-서명 + 만료시각을 담은 토큰을 발급하고, 다운로드
 * 라우트가 서명·만료·대상(딜/파일 id)을 검증한 뒤에만 바이트를 내려준다.
 * 조직 경계는 라우트가 `getCrmService().getDeal(ctx, dealId)` 로 다시 확인한다
 * (담당범위 포함 — 토큰이 유효해도 그 사용자가 그 딜을 볼 수 없으면 404).
 *
 * 서명 키는 blue/green·Vercel↔VPS 전환에도 같은 값이어야 하는
 * `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` 에서 용도 분리해 파생한다. 원키를 HMAC
 * 메시지 키로 직접 쓰지 않으며 응답·로그로 내보내지 않는다.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` 는 이 서명에 **쓰지 않는다**. 예전 Vercel 릴리스가 그 키로
 * 발급한 5분 토큰을 받아 주던 전환 호환 경로는 제거했다(전환 완료). 그 경로가 남아 있으면
 * 야간 배치 때문에 service_role 을 같은 프로세스에 넣는 순간, DB 자격증명이 다운로드
 * 서명키로도 인정된다. 다시 넣지 않는다.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const DEV_ONLY_FALLBACK_SECRET = "dev-only-insecure-file-url-secret";
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5분
const FILE_SIGNING_CONTEXT = "moawork:file-download:v1";

function decodeActionsKey(value: string | undefined): Buffer | null {
  if (!value || value !== value.trim() || /\s/.test(value)) return null;
  try {
    const decoded = Buffer.from(value, "base64");
    if (![16, 24, 32].includes(decoded.length)) return null;
    return decoded.toString("base64") === value ? decoded : null;
  } catch {
    return null;
  }
}

function primarySigningKey(): Buffer | null {
  const raw = process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY;
  if (raw === undefined) return null;
  const decoded = decodeActionsKey(raw);
  if (!decoded) {
    throw new Error("파일 다운로드 안정키 설정이 올바르지 않습니다.");
  }
  return createHmac("sha256", decoded).update(FILE_SIGNING_CONTEXT).digest();
}

function issuingKey(): Buffer | string {
  const primary = primarySigningKey();
  if (primary) return primary;
  if (process.env.NODE_ENV === "production") {
    throw new Error("파일 다운로드 서명 설정이 없습니다.");
  }
  return DEV_ONLY_FALLBACK_SECRET;
}

function verificationKeys(): Array<Buffer | string> {
  let primary: Buffer | null;
  try {
    primary = primarySigningKey();
  } catch {
    return [];
  }

  const keys: Array<Buffer | string> = [];
  if (primary) keys.push(primary);
  if (keys.length === 0 && process.env.NODE_ENV !== "production") {
    keys.push(DEV_ONLY_FALLBACK_SECRET);
  }
  return keys;
}

function sign(payload: string, key: Buffer | string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function signatureMatches(payload: string, supplied: string, key: Buffer | string): boolean {
  const expected = sign(payload, key);
  const actualBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export interface SignedFileToken {
  dealId: string;
  fileId: string;
  /** epoch ms 만료시각. */
  exp: number;
}

/** 토큰 문자열 생성: `<dealId>.<fileId>.<exp>.<서명>`. */
export function issueFileToken(dealId: string, fileId: string, ttlMs = DEFAULT_TTL_MS): string {
  const exp = Date.now() + ttlMs;
  const payload = `${dealId}.${fileId}.${exp}`;
  return `${payload}.${sign(payload, issuingKey())}`;
}

/** 토큰 검증. 서명 불일치·만료·형식 오류는 전부 null(호출부는 401/403 으로 수렴). */
export function verifyFileToken(token: string): SignedFileToken | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [dealId, fileId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!dealId || !fileId || !Number.isFinite(exp)) return null;

  const payload = `${dealId}.${fileId}.${expStr}`;
  if (!verificationKeys().some((key) => signatureMatches(payload, sig, key))) {
    return null;
  }
  if (Date.now() > exp) return null;

  return { dealId, fileId, exp };
}

/** 클라이언트에 내려줄 다운로드 경로(만료 포함, org/scope 검증은 라우트가 재확인). */
export function buildDownloadUrl(dealId: string, fileId: string, ttlMs?: number): string {
  const token = issueFileToken(dealId, fileId, ttlMs);
  return `/api/deals/${dealId}/files/${fileId}?token=${encodeURIComponent(token)}`;
}
