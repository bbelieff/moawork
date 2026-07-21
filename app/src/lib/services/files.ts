// T04 · core.files — 딜 파일 첨부(로컬 우선).
//
// ⚠ 정본 스키마(001+002)에 파일 테이블이 없다. 독자 CREATE TABLE 금지 규칙에 따라
//   **새 마이그레이션을 만들지 않고** 로컬 인메모리 스토어로 먼저 구현한다.
//   스키마는 기획 합의 후 단일 선행 PR 로만 추가된다(디스패치 DQ-0014).
//
// TODO(T04): Supabase 연결 시 교체 지점
//   1) 저장: 인메모리 Map → Supabase Storage(비공개 버킷, 경로 buildStoragePath())
//   2) 메타: StoredFile → 파일 메타 테이블 row
//   3) 다운로드: data_url → 서명 URL(만료 처리)
//   교체 시 이 파일의 공개 계약(list/attach/remove/get)은 유지한다.
//
// 경계: 공용 인터페이스(@/lib/types, @/lib/repo/index.ts)는 건드리지 않는다.
//       파일은 아직 공용 포트에 없으므로 T04 자체 서비스로 둔다.

import type { Ctx } from "@/lib/types";

/** 업로드 최대 크기 — 10MB. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** 차단 확장자(실행/스크립트) — 게이트 §3-B "악성·실행 파일 차단". */
export const BLOCKED_EXTENSIONS = [
  "exe", "bat", "cmd", "com", "scr", "pif", "msi", "msp",
  "dll", "sys", "vbs", "vbe", "js", "jse", "wsf", "wsh",
  "ps1", "psm1", "sh", "bash", "jar", "app", "deb", "rpm",
] as const;

/** 파일명에 쓸 수 없는 문자(파일시스템/경로 안전). */
const UNSAFE_NAME_CHARS = '<>:"|?*';

/** 첨부 파일 1건(로컬). */
export interface StoredFile {
  id: string;
  org_id: string;
  deal_id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
  /** 로컬 개발용 내용(data URL). Supabase 연결 후에는 storage_path 로 대체. */
  data_url?: string;
}

export interface NewFileInput {
  name: string;
  mime_type?: string;
  size_bytes: number;
  data_url?: string;
}

// ── 검증(순수) ────────────────────────────────────────────

export type ValidationResult = { ok: true } | { ok: false; reason: string };

/** 파일명에서 확장자(소문자)를 뽑는다. 없으면 null. */
export function extensionOf(name: string): string | null {
  const base = name.split(/[\\/]/).pop() ?? name;
  const i = base.lastIndexOf(".");
  if (i <= 0 || i === base.length - 1) return null;
  return base.slice(i + 1).toLowerCase();
}

/**
 * 파일명 정규화 — 경로 구분자·제어문자 제거(경로 탈출 방지), 길이 제한.
 * 저장 경로 생성 시 반드시 이 함수를 거친다.
 */
export function sanitizeFileName(name: string): string {
  // 경로 구분자 기준 마지막 조각만(디렉터리 탈출 방지)
  const base = (name.split(/[\\/]/).pop() ?? name).trim();

  // 제어문자(<0x20) + 파일시스템 위험문자를 '_' 로 치환.
  // (정규식 대신 코드포인트 검사 — 소스에 제어문자를 넣지 않기 위함)
  const cleaned = Array.from(base)
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x20 || UNSAFE_NAME_CHARS.includes(ch) ? "_" : ch;
    })
    .join("");

  // 선행 점 제거(숨김파일 / 상위경로 표기 방지)
  const safe = cleaned.replace(/^\.+/, "_").slice(0, 200);
  return safe.trim() === "" ? "untitled" : safe;
}

/** 업로드 가능 여부 검증 — 크기·확장자·이름. */
export function validateUpload(input: {
  name: string;
  size_bytes: number;
}): ValidationResult {
  const name = input.name.trim();
  if (name === "") return { ok: false, reason: "파일명이 비어 있습니다." };

  if (!Number.isFinite(input.size_bytes) || input.size_bytes < 0) {
    return { ok: false, reason: "파일 크기를 확인할 수 없습니다." };
  }
  if (input.size_bytes === 0) {
    return { ok: false, reason: "빈 파일은 업로드할 수 없습니다." };
  }
  if (input.size_bytes > MAX_FILE_BYTES) {
    return {
      ok: false,
      reason: `파일이 너무 큽니다 (최대 ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB).`,
    };
  }

  const ext = extensionOf(name);
  if (ext === null) {
    return { ok: false, reason: "확장자가 없는 파일은 업로드할 수 없습니다." };
  }
  if ((BLOCKED_EXTENSIONS as readonly string[]).includes(ext)) {
    return { ok: false, reason: `허용되지 않는 형식입니다 (.${ext}).` };
  }
  return { ok: true };
}

/** 바이트를 사람이 읽는 크기로. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes}B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)}${units[i]}`;
}

/**
 * 저장 경로(스토리지 키). Supabase Storage 연결 시 그대로 사용한다.
 * 첫 세그먼트를 org_id 로 두어 버킷 RLS(org 격리)를 걸 수 있게 한다.
 */
export function buildStoragePath(
  orgId: string,
  dealId: string,
  fileId: string,
  fileName: string,
): string {
  return `${orgId}/${dealId}/${fileId}__${sanitizeFileName(fileName)}`;
}

// ── 로컬 스토어 ───────────────────────────────────────────

export class FileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileValidationError";
  }
}

interface FilesStore {
  files: Map<string, StoredFile>;
  seq: number;
}

const globalFiles = globalThis as unknown as { __moaworkFiles?: FilesStore };

function store(): FilesStore {
  if (!globalFiles.__moaworkFiles) {
    globalFiles.__moaworkFiles = { files: new Map(), seq: 0 };
  }
  return globalFiles.__moaworkFiles;
}

/** 테스트용 초기화. */
export function __resetFiles(): void {
  globalFiles.__moaworkFiles = { files: new Map(), seq: 0 };
}

/** 딜에 첨부된 파일 목록(최신순). org 스코핑 적용. */
export function listDealFiles(ctx: Ctx, dealId: string): StoredFile[] {
  return [...store().files.values()]
    .filter((f) => f.org_id === ctx.org.id && f.deal_id === dealId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
}

/** 파일 1건 조회(org 스코핑). */
export function getFile(ctx: Ctx, fileId: string): StoredFile | undefined {
  const f = store().files.get(fileId);
  return f && f.org_id === ctx.org.id ? f : undefined;
}

/**
 * 딜에 파일을 첨부한다. 검증 실패 시 FileValidationError.
 * @throws FileValidationError
 */
export function attachFile(
  ctx: Ctx,
  dealId: string,
  input: NewFileInput,
  now: () => string = () => new Date().toISOString(),
): StoredFile {
  const verdict = validateUpload({ name: input.name, size_bytes: input.size_bytes });
  if (!verdict.ok) throw new FileValidationError(verdict.reason);

  const s = store();
  s.seq += 1;
  const id = `file-${s.seq}`;
  const file: StoredFile = {
    id,
    org_id: ctx.org.id,
    deal_id: dealId,
    name: sanitizeFileName(input.name),
    mime_type: input.mime_type ?? "application/octet-stream",
    size_bytes: input.size_bytes,
    uploaded_by: ctx.user.id,
    created_at: now(),
    data_url: input.data_url,
  };
  s.files.set(id, file);
  return file;
}

/** 첨부 해제(삭제). org 스코핑. 없으면 false. */
export function removeFile(ctx: Ctx, fileId: string): boolean {
  const f = getFile(ctx, fileId);
  if (!f) return false;
  return store().files.delete(fileId);
}

/** 딜의 첨부 건수. */
export function countDealFiles(ctx: Ctx, dealId: string): number {
  return listDealFiles(ctx, dealId).length;
}
