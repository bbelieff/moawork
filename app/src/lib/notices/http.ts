/**
 * 공지 API 입력 검증 + 에러 매핑 (T04).
 *
 * `@/lib/crm/http` 의 toErrorResponse 는 crm 자체 NotFoundError 만 404 로 매핑한다.
 * 공지는 보드 엔진(@/lib/boards)의 에러를 던지므로 여기서 별도로 매핑한다.
 */

import { BoardRuleError, NotFoundError } from "@/lib/boards";
import { UnauthorizedError } from "@/lib/crm/context";
import {
  NOTICE_AUDIENCE_OPTIONS,
  NOTICE_CATEGORY_OPTIONS,
  type NewNotice,
  type NoticePatch,
} from "./types";
import { NoticeForbiddenError, NoticeRuleError } from "./service";

export class NoticeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoticeInputError";
  }
}

export function jsonOk(data: unknown, status = 200): Response {
  return Response.json({ data }, { status });
}

export function toNoticeErrorResponse(err: unknown): Response {
  const map = (status: number, message: string) => Response.json({ error: message }, { status });
  if (err instanceof UnauthorizedError) return map(401, err.message);
  if (err instanceof NoticeForbiddenError) return map(403, err.message);
  if (err instanceof NotFoundError) return map(404, err.message);
  if (err instanceof NoticeInputError) return map(400, err.message);
  if (err instanceof NoticeRuleError) return map(400, err.message);
  if (err instanceof BoardRuleError) return map(400, err.message);
  return map(500, err instanceof Error ? err.message : "알 수 없는 오류");
}

const VALID_CATEGORY_IDS = new Set(NOTICE_CATEGORY_OPTIONS.map((o) => o.id));
const VALID_AUDIENCE_IDS = new Set(NOTICE_AUDIENCE_OPTIONS.map((o) => o.id));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function asRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new NoticeInputError("본문은 JSON 객체여야 합니다");
  return raw as Record<string, unknown>;
}

function optionalString(v: unknown, field: string): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new NoticeInputError(`${field}: 문자열이어야 합니다`);
  return v;
}

function optionalCategory(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string" || !VALID_CATEGORY_IDS.has(v))
    throw new NoticeInputError("분류: 허용되지 않은 값입니다");
  return v;
}

function optionalAudience(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string" || !VALID_AUDIENCE_IDS.has(v))
    throw new NoticeInputError("열람 대상: 허용되지 않은 값입니다");
  return v;
}

function optionalDate(v: unknown, field = "게시일"): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string" || !DATE_RE.test(v))
    throw new NoticeInputError(`${field}: YYYY-MM-DD 형식이어야 합니다`);
  return v;
}

function optionalBool(v: unknown, field: string): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") throw new NoticeInputError(`${field}: true/false 여야 합니다`);
  return v;
}

export function parseNewNotice(raw: unknown): NewNotice {
  const o = asRecord(raw);
  const title = optionalString(o.title, "제목");
  if (title === undefined || title.trim() === "")
    throw new NoticeInputError("제목은 필수입니다");
  return {
    title,
    body: optionalString(o.body, "본문"),
    categoryId: optionalCategory(o.categoryId),
    pinned: optionalBool(o.pinned, "상단고정"),
    publishedAt: optionalDate(o.publishedAt),
    endedAt: optionalDate(o.endedAt, "종료일"),
    audienceId: optionalAudience(o.audienceId),
  };
}

export function parseNoticePatch(raw: unknown): NoticePatch {
  const o = asRecord(raw);
  const patch: NoticePatch = {};
  // 전달된 키만 담는다 — 미전달 셀은 서비스가 보존한다.
  if ("title" in o) {
    const title = optionalString(o.title, "제목");
    if (title === undefined || title.trim() === "")
      throw new NoticeInputError("제목은 비울 수 없습니다");
    patch.title = title;
  }
  if ("body" in o) patch.body = optionalString(o.body, "본문");
  if ("categoryId" in o) patch.categoryId = optionalCategory(o.categoryId);
  if ("pinned" in o) patch.pinned = optionalBool(o.pinned, "상단고정");
  if ("publishedAt" in o) patch.publishedAt = optionalDate(o.publishedAt);
  if ("endedAt" in o) patch.endedAt = optionalDate(o.endedAt, "종료일");
  if ("audienceId" in o) patch.audienceId = optionalAudience(o.audienceId);
  if (Object.keys(patch).length === 0) throw new NoticeInputError("변경할 항목이 없습니다");
  return patch;
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new NoticeInputError("JSON 본문을 파싱할 수 없습니다");
  }
}
