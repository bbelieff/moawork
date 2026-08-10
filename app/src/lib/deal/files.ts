/**
 * 딜 첨부파일 — 비동기 경로 (BBE-16 · 딜 상세 협업).
 *
 * ⚠ 왜 새 파일인가: 기존 `@/lib/services/files.ts`(T04)는 동기 `getRepo()` 위에서 돈다.
 *   `getRepo()`는 **환경과 무관하게 항상 `LocalRepo`(in-memory)** — 즉 그 경로로 올린 첨부는
 *   프로덕션(서버리스, 인스턴스 재시작마다 초기화)에서 **영속되지 않는다**. 실측:
 *   `app/src/lib/repo/index.ts` 의 `getRepo()` 는 env 분기 없이 무조건 `new LocalRepo()`.
 *   BBE-16 은 "완주 조건: 배포 확인까지"를 요구하므로, 이 기능은 실제로 저장되는
 *   `getCrmService()`(Supabase-or-local, 환경변수로 분기) 경로로 새로 구현한다.
 *   기존 파일은 건드리지 않는다(다른 소비처가 있을 수 있음 — 003 임의보드 첨부 등).
 *
 * 저장 위치: `deals.custom.files[]` (jsonb) — 기존과 같은 자리, 다른 저장 경로.
 * 바이트: 내부 필드 `content_b64` 는 **클라이언트에 절대 직렬화하지 않는다**
 *   (BBE-16 "원본 data URL을 저장하지 않는다" — 저장 자체는 하되, 응답 객체에서
 *   빼서 "URL 처럼 유출"되는 경로를 원천 차단한다). 다운로드는 서명 URL(`fileSignedUrl.ts`)만.
 */

import type { Ctx } from "@/lib/types";
import { getCrmService } from "@/lib/crm";
import {
  MAX_FILE_BYTES,
  sanitizeFileName,
  validateUpload,
  type ValidationResult,
} from "@/lib/services/files";

const FILES_CUSTOM_KEY = "deal_files";

/** 딜 상세 화면/API 에 노출되는 형태 — 바이트 내용은 포함하지 않는다. */
export interface DealFileMeta {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
}

/** 저장소 내부 표현(바이트 포함) — 서비스 밖으로 내보내지 않는다. */
interface StoredDealFile extends DealFileMeta {
  content_b64: string;
}

export class DealFileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DealFileValidationError";
  }
}

export class DealFileNotFoundError extends Error {
  constructor(message = "파일을 찾을 수 없습니다") {
    super(message);
    this.name = "DealFileNotFoundError";
  }
}

// ── 순수 함수 ──────────────────────────────────────────────

function isStoredFile(v: unknown): v is StoredDealFile {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.name === "string" && typeof o.content_b64 === "string";
}

function readStoredFiles(custom: Record<string, unknown> | null | undefined): StoredDealFile[] {
  const raw = custom?.[FILES_CUSTOM_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.filter(isStoredFile);
}

function toMeta(f: StoredDealFile): DealFileMeta {
  const { content_b64: _content_b64, ...meta } = f;
  void _content_b64;
  return meta;
}

/** data:mime;base64,XXXX → 순수 base64 페이로드만. 형식이 아니면 원문 그대로(방어적). */
function stripDataUrlPrefix(input: string): string {
  const m = /^data:[^;]*;base64,([\s\S]*)$/.exec(input);
  return m ? m[1] : input;
}

// ── 서비스(비동기) ─────────────────────────────────────────

/** 딜 첨부 메타 목록(최신순). 바이트는 포함하지 않는다. */
export async function listDealFiles(ctx: Ctx, dealId: string): Promise<DealFileMeta[]> {
  const deal = await getCrmService().getDeal(ctx, dealId);
  return readStoredFiles(deal.custom)
    .map(toMeta)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
}

export interface NewDealFileInput {
  name: string;
  mime_type?: string;
  size_bytes: number;
  /** 브라우저 FileReader.readAsDataURL 결과(`data:...;base64,...`) 또는 순수 base64. */
  data_url: string;
}

export function validateDealFileUpload(input: {
  name: string;
  size_bytes: number;
}): ValidationResult {
  return validateUpload(input);
}

function genId(): string {
  return `dfile-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export async function attachDealFile(
  ctx: Ctx,
  dealId: string,
  input: NewDealFileInput,
): Promise<DealFileMeta> {
  const verdict = validateUpload({ name: input.name, size_bytes: input.size_bytes });
  if (!verdict.ok) throw new DealFileValidationError(verdict.reason);
  if (input.size_bytes > MAX_FILE_BYTES) {
    throw new DealFileValidationError("파일이 너무 큽니다");
  }

  const deal = await getCrmService().getDeal(ctx, dealId);
  const stored: StoredDealFile = {
    id: genId(),
    name: sanitizeFileName(input.name),
    mime_type: input.mime_type ?? "application/octet-stream",
    size_bytes: input.size_bytes,
    uploaded_by: ctx.user.id,
    created_at: new Date().toISOString(),
    content_b64: stripDataUrlPrefix(input.data_url),
  };

  const nextList = [...readStoredFiles(deal.custom), stored];
  await getCrmService().updateDeal(ctx, dealId, {
    custom: { ...(deal.custom ?? {}), [FILES_CUSTOM_KEY]: nextList },
  });
  return toMeta(stored);
}

export async function removeDealFile(ctx: Ctx, dealId: string, fileId: string): Promise<void> {
  const deal = await getCrmService().getDeal(ctx, dealId);
  const before = readStoredFiles(deal.custom);
  if (!before.some((f) => f.id === fileId)) throw new DealFileNotFoundError();

  await getCrmService().updateDeal(ctx, dealId, {
    custom: { ...(deal.custom ?? {}), [FILES_CUSTOM_KEY]: before.filter((f) => f.id !== fileId) },
  });
}

/**
 * 서명 URL 다운로드 라우트 전용 — 바이트를 반환한다.
 * ⚠ 이 함수는 API 라우트 밖에서 호출하지 않는다(응답 직렬화 경로에 절대 노출 금지).
 */
export async function readDealFileBytes(
  ctx: Ctx,
  dealId: string,
  fileId: string,
): Promise<{ meta: DealFileMeta; buffer: Buffer } | null> {
  const deal = await getCrmService().getDeal(ctx, dealId);
  const found = readStoredFiles(deal.custom).find((f) => f.id === fileId);
  if (!found) return null;
  return { meta: toMeta(found), buffer: Buffer.from(found.content_b64, "base64") };
}
