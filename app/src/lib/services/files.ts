// T04 · core.files — 딜 파일 첨부(로컬 우선, jsonb 저장).
//
// 저장 위치(기획2 DQ-0014 판정): **별도 테이블 없이 `deals.custom.files[]` (jsonb)**.
//   - 신규 마이그레이션을 만들지 않는다(정본 = 001 + 002 + 003).
//   - 전용 attachments 테이블은 Supabase Storage 연결 시 **기획이 004 로 작성**한다.
//   - 임의 보드(003)의 첨부는 같은 구조를 item_values 에 담는다(동일 헬퍼 재사용 가능).
//
// TODO(T04): Supabase Storage 연결 시 교체 지점
//   1) 바이트: data_url(로컬 인라인) → Storage 업로드 후 storage_path 기록
//   2) 다운로드: data_url → 서명 URL(만료 처리)
//   3) 메타: 004 attachments 테이블이 생기면 jsonb → 테이블로 이관(읽기 계약 유지)
//
// 경계: 공용 인터페이스(@/lib/types, @/lib/repo/index.ts)는 **변경하지 않는다**.
//       기존 Repo.getDeal/updateDeal(custom) 만 사용하므로 org·담당범위 격리는 Repo 가 보장한다.

import { getRepo } from "@/lib/repo";
import type { Ctx, Deal } from "@/lib/types";

/**
 * core.files 가 필요로 하는 **최소 포트**(구조적 타이핑).
 *
 * ⚠ 머지 의존성: `getDeal` / `updateDeal` 은 **T02crm(②)이 공유 Repo 에 추가한** 메서드다.
 *   ①T03 파운데이션 단독 Repo 에는 조회 계열(listDeals/listStages/listFieldDefs…)만 있고
 *   딜 단건 조회·수정이 없다. ② 폐기 시 이 두 메서드를 포트 소유자가 제공해야
 *   core.files 가 동작한다(디스패치로 요청). core.dash 는 조회만 쓰므로 영향 없음.
 *
 * 이 인터페이스를 별도로 두는 이유: 파일 기능이 공용 Repo 전체가 아니라
 * **정확히 이 2개 메서드에만** 의존한다는 사실을 컴파일 단계에서 드러내기 위함.
 */
export interface DealFilesPort {
  getDeal(ctx: Ctx, id: string): Deal | undefined;
  updateDeal(
    ctx: Ctx,
    id: string,
    patch: { custom?: Record<string, unknown> },
  ): Deal | undefined;
}

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

/** deal.custom 안에서 첨부 배열이 놓이는 키. */
export const FILES_CUSTOM_KEY = "files";

/** 첨부 1건 — deal.custom.files[] 의 원소. */
export interface DealFileRef {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
  /** 로컬 개발용 내용(data URL). Storage 연결 후에는 storage_path 사용. */
  data_url?: string;
  /** Supabase Storage 경로(연결 후 채워짐). */
  storage_path?: string;
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
 * Storage 경로(004 연결 대비). 첫 세그먼트를 org_id 로 두어 버킷 RLS(org 격리)를 건다.
 */
export function buildStoragePath(
  orgId: string,
  dealId: string,
  fileId: string,
  fileName: string,
): string {
  return `${orgId}/${dealId}/${fileId}__${sanitizeFileName(fileName)}`;
}

// ── jsonb 조작(순수) — deal.custom.files[] ────────────────

/** 알 수 없는 jsonb 값에서 첨부 배열을 안전하게 읽는다. 형식이 어긋나면 빈 배열. */
export function readFileRefs(
  custom: Record<string, unknown> | null | undefined,
): DealFileRef[] {
  const raw = custom?.[FILES_CUSTOM_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is DealFileRef => {
    if (typeof v !== "object" || v === null) return false;
    const o = v as Record<string, unknown>;
    return typeof o.id === "string" && typeof o.name === "string";
  });
}

/** 첨부를 추가한 새 custom 객체를 만든다(불변). */
export function appendFileRef(
  custom: Record<string, unknown> | null | undefined,
  ref: DealFileRef,
): Record<string, unknown> {
  return {
    ...(custom ?? {}),
    [FILES_CUSTOM_KEY]: [...readFileRefs(custom), ref],
  };
}

/** 첨부를 제거한 새 custom 객체를 만든다(불변). */
export function removeFileRef(
  custom: Record<string, unknown> | null | undefined,
  fileId: string,
): Record<string, unknown> {
  return {
    ...(custom ?? {}),
    [FILES_CUSTOM_KEY]: readFileRefs(custom).filter((f) => f.id !== fileId),
  };
}

// ── 서비스 (Repo 경유 — org·담당범위 격리는 Repo 가 보장) ──

export class FileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileValidationError";
  }
}

export class DealNotFoundError extends Error {
  constructor(message = "딜을 찾을 수 없습니다") {
    super(message);
    this.name = "DealNotFoundError";
  }
}

function requireRepo(repo: DealFilesPort | undefined): DealFilesPort {
  if (repo) return repo;
  if (process.env.NODE_ENV !== "production") return getRepo();
  throw new Error("Production file callers must provide the persistent file port");
}

export interface FileServiceOptions {
  repo?: DealFilesPort;
  /** id 생성기(테스트 결정성). */
  genId?: () => string;
  /** 현재 시각(테스트 결정성). */
  now?: () => string;
}

function defaultGenId(): string {
  return `file-${Math.random().toString(36).slice(2, 10)}`;
}

/** 딜에 첨부된 파일 목록(최신순). 딜이 없거나 권한 밖이면 빈 배열. */
export function listDealFiles(
  ctx: Ctx,
  dealId: string,
  opts: FileServiceOptions = {},
): DealFileRef[] {
  const repo = requireRepo(opts.repo);
  const deal = repo.getDeal(ctx, dealId);
  if (!deal) return [];
  return [...readFileRefs(deal.custom)].sort(
    (a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
  );
}

/** 딜의 첨부 1건 조회. */
export function getFile(
  ctx: Ctx,
  dealId: string,
  fileId: string,
  opts: FileServiceOptions = {},
): DealFileRef | undefined {
  return listDealFiles(ctx, dealId, opts).find((f) => f.id === fileId);
}

/** 딜의 첨부 건수. */
export function countDealFiles(
  ctx: Ctx,
  dealId: string,
  opts: FileServiceOptions = {},
): number {
  return listDealFiles(ctx, dealId, opts).length;
}

/**
 * 딜에 파일을 첨부한다(= deal.custom.files[] 에 append).
 * @throws FileValidationError 크기/확장자 위반
 * @throws DealNotFoundError  딜이 없거나 권한 밖
 */
export function attachFile(
  ctx: Ctx,
  dealId: string,
  input: NewFileInput,
  opts: FileServiceOptions = {},
): DealFileRef {
  const verdict = validateUpload({ name: input.name, size_bytes: input.size_bytes });
  if (!verdict.ok) throw new FileValidationError(verdict.reason);

  const repo = requireRepo(opts.repo);
  const deal = repo.getDeal(ctx, dealId);
  if (!deal) throw new DealNotFoundError();

  const ref: DealFileRef = {
    id: (opts.genId ?? defaultGenId)(),
    name: sanitizeFileName(input.name),
    mime_type: input.mime_type ?? "application/octet-stream",
    size_bytes: input.size_bytes,
    uploaded_by: ctx.user.id,
    created_at: (opts.now ?? (() => new Date().toISOString()))(),
    data_url: input.data_url,
  };

  repo.updateDeal(ctx, dealId, { custom: appendFileRef(deal.custom, ref) });
  return ref;
}

/** 첨부 해제. 대상이 없으면 false. */
export function removeFile(
  ctx: Ctx,
  dealId: string,
  fileId: string,
  opts: FileServiceOptions = {},
): boolean {
  const repo = requireRepo(opts.repo);
  const deal = repo.getDeal(ctx, dealId);
  if (!deal) return false;

  const before = readFileRefs(deal.custom);
  if (!before.some((f) => f.id === fileId)) return false;

  repo.updateDeal(ctx, dealId, { custom: removeFileRef(deal.custom, fileId) });
  return true;
}
