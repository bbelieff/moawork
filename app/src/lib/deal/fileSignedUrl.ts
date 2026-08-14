/**
 * 딜 첨부파일 서명 다운로드 URL (BBE-16).
 *
 * "만료 서명 URL" 요건: HMAC-서명 + 만료시각을 담은 토큰을 발급하고, 다운로드
 * 라우트가 서명·만료·대상(딜/파일 id)을 검증한 뒤에만 바이트를 내려준다.
 * 조직 경계는 라우트가 `getCrmService().getDeal(ctx, dealId)` 로 다시 확인한다
 * (담당범위 포함 — 토큰이 유효해도 그 사용자가 그 딜을 볼 수 없으면 404).
 *
 * 서명 키: `SUPABASE_SERVICE_ROLE_KEY` 를 재사용한다(이미 존재하는 서버 전용 비밀값 —
 * 새 필수 환경변수를 늘리지 않는다). 로컬 개발(그 키가 없을 때)만 고정 개발용 키로 폴백한다
 * — **프로덕션에서는 반드시 실 서비스 키가 있어야** 서명이 위조 불가능하다.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const DEV_ONLY_FALLBACK_SECRET = "dev-only-insecure-file-url-secret";
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5분

function signingSecret(): string {
  const configured = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("파일 다운로드 서명 설정이 없습니다.");
  }
  return DEV_ONLY_FALLBACK_SECRET;
}

function sign(payload: string): string {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
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
  return `${payload}.${sign(payload)}`;
}

/** 토큰 검증. 서명 불일치·만료·형식 오류는 전부 null(호출부는 401/403 으로 수렴). */
export function verifyFileToken(token: string): SignedFileToken | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [dealId, fileId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!dealId || !fileId || !Number.isFinite(exp)) return null;

  const expected = sign(`${dealId}.${fileId}.${expStr}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Date.now() > exp) return null;

  return { dealId, fileId, exp };
}

/** 클라이언트에 내려줄 다운로드 경로(만료 포함, org/scope 검증은 라우트가 재확인). */
export function buildDownloadUrl(dealId: string, fileId: string, ttlMs?: number): string {
  const token = issueFileToken(dealId, fileId, ttlMs);
  return `/api/deals/${dealId}/files/${fileId}?token=${encodeURIComponent(token)}`;
}
