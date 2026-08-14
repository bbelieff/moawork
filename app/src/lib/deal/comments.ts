/**
 * 딜 댓글 (BBE-16 · 딜 상세 협업).
 *
 * 저장 위치: 신규 테이블 없이 `deals.custom.comments[]` (jsonb) — `files.ts`(T04)가 이미
 * 검증한 패턴을 그대로 따른다. `updateDeal` 의 `custom` 은 **키 단위 병합**이므로
 * (BUG-0003 회귀 테스트로 고정됨) 다른 트랙의 custom 값을 지우지 않는다.
 *
 * 수정 이력: 댓글을 고치면 이전 본문을 `edit_history[]` 에 남긴다(완전 삭제하지 않음).
 *
 * 동시 수정 충돌: 수정 시 `expectedVersion` 을 함께 받아 현재 `version` 과 비교한다 —
 * 다르면 누군가 먼저 고친 것이므로 덮어쓰지 않고 `ConcurrentEditError` 를 던진다.
 * ⚠ 타임스탬프 문자열이 아니라 **정수 버전**으로 비교한다 — `new Date().toISOString()`
 * 은 밀리초 해상도라 빠른 연속 편집(테스트·자동화·같은 밀리초 내 재시도)이 같은
 * 문자열을 만들 수 있고, 그러면 충돌을 놓친다. 정수 증가 카운터는 이 문제가 없다.
 */

import type { Ctx } from "@/lib/types";
import { getCrmService } from "@/lib/crm";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

const COMMENTS_CUSTOM_KEY = "comments";

export interface CommentEditRecord {
  body: string;
  at: string;
}

export const COMMENT_KINDS = {
  note: "note",
  /** 되돌려보내기(보완요청) — assignee 에게 requested 알림과 함께 발행. */
  returnRequest: "return_request",
} as const;
export type CommentKind = (typeof COMMENT_KINDS)[keyof typeof COMMENT_KINDS];

export interface DealComment {
  id: string;
  author_id: string;
  body: string;
  kind: CommentKind;
  /** 언급된 조직 멤버 user_id 목록(멘션 알림 발송에 쓴다). */
  mentioned_ids: string[];
  created_at: string;
  /** 마지막 수정 시각(표시용). 한 번도 안 고쳤으면 null. */
  edited_at: string | null;
  edit_history: CommentEditRecord[];
  /** 낙관적 잠금 버전 — 생성 시 1, 수정할 때마다 +1. */
  version: number;
}

export class CommentNotFoundError extends Error {
  constructor(message = "댓글을 찾을 수 없습니다") {
    super(message);
    this.name = "CommentNotFoundError";
  }
}

export class CommentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommentValidationError";
  }
}

/** 낙관적 잠금 충돌 — 편집 사이에 다른 사람이 먼저 저장했다. */
export class ConcurrentEditError extends Error {
  constructor(message = "다른 사용자가 방금 이 댓글을 수정했습니다. 새로고침 후 다시 시도하세요.") {
    super(message);
    this.name = "ConcurrentEditError";
  }
}

export class CommentPermissionError extends Error {
  constructor(message = "본인이 작성한 댓글만 수정할 수 있습니다.") {
    super(message);
    this.name = "CommentPermissionError";
  }
}

export const MAX_COMMENT_LENGTH = 4000;

// ── 순수 함수(jsonb 조작) ──────────────────────────────────

/** 알 수 없는 jsonb 값에서 댓글 배열을 안전하게 읽는다. 형식이 어긋나면 빈 배열. */
export function readComments(
  custom: Record<string, unknown> | null | undefined,
): DealComment[] {
  const raw = custom?.[COMMENTS_CUSTOM_KEY];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
    .filter((o): o is Record<string, unknown> & { id: string; body: string } =>
      typeof o.id === "string" && typeof o.body === "string",
    )
    .map((o) => ({
      id: o.id,
      author_id: typeof o.author_id === "string" ? o.author_id : "",
      body: o.body,
      // 과거 저장분(kind 필드 도입 전)은 일반 댓글로 취급.
      kind: o.kind === COMMENT_KINDS.returnRequest ? COMMENT_KINDS.returnRequest : COMMENT_KINDS.note,
      mentioned_ids: Array.isArray(o.mentioned_ids)
        ? o.mentioned_ids.filter((x): x is string => typeof x === "string")
        : [],
      created_at: typeof o.created_at === "string" ? o.created_at : "",
      edited_at: typeof o.edited_at === "string" ? o.edited_at : null,
      edit_history: Array.isArray(o.edit_history)
        ? (o.edit_history as unknown[]).filter(
            (e): e is CommentEditRecord =>
              typeof e === "object" &&
              e !== null &&
              typeof (e as Record<string, unknown>).body === "string" &&
              typeof (e as Record<string, unknown>).at === "string",
          )
        : [],
      // 과거 저장분(version 필드 도입 전)은 1로 간주 — 그 값을 최초 expectedVersion 으로 쓰면 된다.
      version: typeof o.version === "number" && Number.isFinite(o.version) ? o.version : 1,
    }));
}

/** 댓글을 추가한 새 custom 객체(불변). */
export function appendComment(
  custom: Record<string, unknown> | null | undefined,
  comment: DealComment,
): Record<string, unknown> {
  return {
    ...(custom ?? {}),
    [COMMENTS_CUSTOM_KEY]: [...readComments(custom), comment],
  };
}

/**
 * 댓글 본문을 바꾼 새 custom 객체(불변). 이전 본문은 edit_history 에 보존하고 version 을 올린다.
 * 대상이 없으면 그대로 돌려준다(호출부가 존재 확인).
 */
export function applyCommentEdit(
  custom: Record<string, unknown> | null | undefined,
  commentId: string,
  newBody: string,
  now: string,
): Record<string, unknown> {
  const next = readComments(custom).map((c) => {
    if (c.id !== commentId) return c;
    return {
      ...c,
      body: newBody,
      edited_at: now,
      edit_history: [...c.edit_history, { body: c.body, at: c.edited_at ?? c.created_at }],
      version: c.version + 1,
    };
  });
  return { ...(custom ?? {}), [COMMENTS_CUSTOM_KEY]: next };
}

export function validateCommentBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed === "") throw new CommentValidationError("댓글 내용을 입력하세요");
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new CommentValidationError(`댓글은 ${MAX_COMMENT_LENGTH}자를 넘을 수 없습니다`);
  }
  return trimmed;
}

/**
 * 본문에서 `@이름` 패턴을 뽑아 후보 이름 목록으로 반환한다(순수 문자열 매칭).
 * 실제 user_id 해석은 서비스 레이어가 조직 멤버 목록과 대조해서 한다 —
 * 이 함수는 "누구를 불렀는지 표기"만 파싱한다.
 */
export function extractMentionNames(body: string): string[] {
  const names = new Set<string>();
  const re = /@([^\s@]{1,50})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) names.add(m[1]);
  return [...names];
}

function genId(): string {
  return `cmt-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

// ── 서비스(비동기 — getCrmService 경유, 프로덕션에서도 영속) ──────────

export interface AddCommentInput {
  body: string;
  /** 이름 후보 → 조직 멤버 user_id 해석 결과(서비스 호출부가 members 목록으로 미리 매핑). */
  mentionedIds?: string[];
  kind?: CommentKind;
}

/** 댓글 목록(오래된 순 — 타임라인은 시간순 표시). */
export async function listComments(ctx: Ctx, dealId: string): Promise<DealComment[]> {
  const deal = await getCrmService().getDeal(ctx, dealId);
  return [...readComments(deal.custom)].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function addComment(
  ctx: Ctx,
  dealId: string,
  input: AddCommentInput,
): Promise<DealComment> {
  const body = validateCommentBody(input.body);
  const deal = await getCrmService().getDeal(ctx, dealId);

  const comment: DealComment = {
    id: genId(),
    author_id: ctx.user.id,
    body,
    kind: input.kind ?? COMMENT_KINDS.note,
    mentioned_ids: [...new Set(input.mentionedIds ?? [])],
    created_at: new Date().toISOString(),
    edited_at: null,
    edit_history: [],
    version: 1,
  };

  await getCrmService().updateDeal(ctx, dealId, {
    custom: appendComment(deal.custom, comment),
  });
  return comment;
}

export interface EditCommentInput {
  body: string;
  /** 클라이언트가 마지막으로 본 버전. 현재 저장된 version 과 다르면 충돌. */
  expectedVersion: number;
}

export async function editComment(
  ctx: Ctx,
  dealId: string,
  commentId: string,
  input: EditCommentInput,
): Promise<DealComment> {
  const body = validateCommentBody(input.body);
  const deal = await getCrmService().getDeal(ctx, dealId);
  const existing = readComments(deal.custom).find((c) => c.id === commentId);
  if (!existing) throw new CommentNotFoundError();
  if (existing.author_id !== ctx.user.id) throw new CommentPermissionError();

  if (existing.version !== input.expectedVersion) throw new ConcurrentEditError();

  const now = new Date().toISOString();
  if (hasSupabaseEnv()) {
    // 프로덕션은 읽기→쓰기 사이 경쟁을 DB의 단일 UPDATE에서 판정한다. 앱에서 version을
    // 먼저 비교하는 것만으로는 두 요청이 같은 값을 읽은 뒤 모두 성공할 수 있다.
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("edit_deal_comment_atomic", {
      p_org_id: ctx.org.id,
      p_deal_id: dealId,
      p_comment_id: commentId,
      p_body: body,
      p_expected_version: input.expectedVersion,
    });
    if (error) throw new Error(`댓글을 저장하지 못했습니다: ${error.message}`);
    if (data !== true) throw new ConcurrentEditError();
  } else {
    await getCrmService().updateDeal(ctx, dealId, {
      custom: applyCommentEdit(deal.custom, commentId, body, now),
    });
  }

  return {
    ...existing,
    body,
    edited_at: now,
    edit_history: [...existing.edit_history, { body: existing.body, at: existing.edited_at ?? existing.created_at }],
    version: existing.version + 1,
  };
}
