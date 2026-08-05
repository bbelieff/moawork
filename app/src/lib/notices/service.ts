/**
 * 공지사항 서비스 (T04) — 003 보드 엔진 위의 얇은 도메인 레이어.
 *
 * 설계:
 *  - 저장/검증은 전부 `BoardsService` 에 위임한다(셀 정규화·선택지 검증 재사용, 로직 중복 없음).
 *  - 이 모듈이 하는 일은 (a) 공지 보드 찾기/프로비저닝, (b) EAV 셀 ↔ Notice 뷰모델 변환,
 *    (c) 공지 특유의 정렬(상단고정 → 게시일 최신순) 뿐이다.
 *  - 담당범위(scope) 격리는 BoardsRepo 가 이미 적용한다 — 여기서 다시 필터하지 않는다.
 *
 * 경계: 공용 계약(@/lib/types, @/lib/repo/index.ts)과 T02b 보드 엔진 파일은 건드리지 않는다.
 */

import type { Ctx } from "@/lib/types";
import { isManager } from "@/lib/auth/roles";
import { BoardsService, NotFoundError } from "@/lib/boards";
import type { Board, CellValue, ItemWithValues } from "@/lib/boards/types";
import type { BoardsRepo } from "@/lib/boards/store";
import { getBoardsRepo, slugifyKey } from "@/lib/repo/local/boardsRepo";
import {
  NOTICE_AUDIENCE_MANAGERS,
  NOTICE_AUDIENCE_OPTIONS,
  NOTICE_BOARD_NAME,
  NOTICE_BOARD_SOURCE,
  NOTICE_CATEGORY_OPTIONS,
  NOTICE_COLUMNS,
  NOTICE_KEYS,
  type NewNotice,
  type Notice,
  type NoticePatch,
  type NoticeStatus,
} from "./types";

/** KST(UTC+9) 기준 오늘(YYYY-MM-DD). 게시일 기본값. */
export function todayKst(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function toStr(v: CellValue | undefined): string {
  return typeof v === "string" ? v : "";
}

function toBool(v: CellValue | undefined): boolean {
  return v === true;
}

function toNullableStr(v: CellValue | undefined): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

const CATEGORY_LABELS = new Map(NOTICE_CATEGORY_OPTIONS.map((o) => [o.id, o.label]));
const AUDIENCE_LABELS = new Map(NOTICE_AUDIENCE_OPTIONS.map((o) => [o.id, o.label]));

/**
 * 게시 상태 판정 — 날짜만 보고 파생한다.
 *
 * 종료일은 그날까지 포함이다(종료일 == 오늘이면 아직 게시 중).
 * 게시일 미지정은 "즉시 게시"로 본다(기존 공지 하위호환).
 */
export function noticeStatusOf(
  publishedAt: string | null,
  endedAt: string | null,
  today: string,
): NoticeStatus {
  if (endedAt !== null && endedAt < today) return "ended";
  if (publishedAt !== null && publishedAt > today) return "scheduled";
  return "published";
}

/**
 * 이 공지가 이 사용자에게 보여야 하는가.
 *
 * 관리자는 예약·종료분까지 전부 본다(관리 화면이므로). 일반 구성원에게는
 * 게시 중이면서 열람 대상이 자신을 포함하는 것만 보인다.
 */
export function isNoticeVisibleTo(notice: Notice, ctx: Ctx): boolean {
  if (isManager(ctx.role)) return true;
  if (notice.status !== "published") return false;
  return notice.audienceId !== NOTICE_AUDIENCE_MANAGERS;
}

export class NoticesService {
  constructor(
    private readonly boards: BoardsService = new BoardsService(),
    private readonly repo: BoardsRepo = getBoardsRepo(),
  ) {}

  // ── 보드 ──

  /**
   * 공지 보드 조회. source='core.notice' 우선, 없으면 이름으로 폴백.
   * (런타임 생성 보드는 포트에 source 인자가 없어 null 로 저장되기 때문)
   */
  findBoard(ctx: Ctx): Board | undefined {
    const all = this.boards.listBoards(ctx);
    return (
      all.find((b) => b.source === NOTICE_BOARD_SOURCE) ??
      all.find((b) => b.source === null && b.name === NOTICE_BOARD_NAME)
    );
  }

  /**
   * 공지 보드 확보 — 없으면 컬럼까지 프로비저닝해 생성한다.
   * BoardsService.createBoard 는 기본 컬럼(상태/담당/마감일)을 심으므로 쓰지 않고,
   * 포트로 직접 만들어 공지 전용 컬럼만 남긴다.
   */
  ensureBoard(ctx: Ctx): Board {
    const found = this.findBoard(ctx);
    if (found) {
      this.ensureColumns(ctx, found.id);
      return found;
    }

    const board = this.repo.createBoard(ctx, {
      name: NOTICE_BOARD_NAME,
      description: "조직 전체 공지 — 상단고정 공지가 먼저 보입니다",
      icon: "📢",
    });
    for (const col of NOTICE_COLUMNS) this.repo.createColumn(ctx, board.id, col);
    return board;
  }

  /**
   * 이미 존재하는 공지 보드에 빠진 컬럼을 채운다.
   *
   * 종료일·열람 대상은 나중에 추가된 컬럼이라, 먼저 만들어진 보드에는 없다.
   * 없는 컬럼에 셀을 쓰면 setCells 가 거부하므로 쓰기 전에 메운다.
   */
  private ensureColumns(ctx: Ctx, boardId: string): void {
    const existing = new Set(
      this.boards.getBoardDetail(ctx, boardId).columns.map((c) => c.key),
    );
    for (const col of NOTICE_COLUMNS) {
      // key 는 선택 필드다 — 생략되면 저장소가 라벨에서 파생한다. 같은 규칙으로 맞춘다.
      const key = col.key ?? slugifyKey(col.label);
      if (!existing.has(key)) this.repo.createColumn(ctx, boardId, col);
    }
  }

  // ── 공지 CRUD ──

  /**
   * 공지 목록 — 상단고정 우선, 그다음 게시일 최신순(미지정은 뒤), 마지막으로 생성일 최신순.
   * 보드가 아직 없으면 빈 배열(프로비저닝을 강제하지 않는다 — 읽기는 부작용 없이).
   *
   * 예약·종료·관리자 전용 공지는 관리자에게만 보인다(isNoticeVisibleTo).
   */
  list(ctx: Ctx, opts: { limit?: number; now?: Date } = {}): Notice[] {
    const board = this.findBoard(ctx);
    if (!board) return [];
    const today = todayKst(opts.now);
    const notices = this.boards
      .listItems(this.readCtx(ctx), board.id)
      .map((item) => this.toNotice(board.id, item, today))
      .filter((notice) => isNoticeVisibleTo(notice, ctx))
      .sort(compareNotices);
    return opts.limit === undefined ? notices : notices.slice(0, Math.max(0, opts.limit));
  }

  get(ctx: Ctx, noticeId: string, now?: Date): Notice {
    const board = this.findBoard(ctx);
    if (!board) throw new NotFoundError("공지 보드가 없습니다");
    const notice = this.toNotice(
      board.id,
      this.boards.getItem(this.readCtx(ctx), board.id, noticeId),
      todayKst(now),
    );
    // 볼 수 없는 공지는 "없는 것"으로 답한다 — 존재 여부까지 숨긴다.
    if (!isNoticeVisibleTo(notice, ctx)) throw new NotFoundError("공지를 찾을 수 없습니다");
    return notice;
  }

  create(ctx: Ctx, input: NewNotice): Notice {
    requireNoticeManager(ctx);
    const board = this.ensureBoard(ctx);
    const title = input.title.trim();
    if (title === "") throw new NoticeRuleError("제목을 입력하세요");
    assertPeriod(input.publishedAt ?? todayKst(), input.endedAt ?? null);

    const item = this.boards.createItem(ctx, board.id, {
      title,
      // 공지는 조직 전체 공람 — 담당자를 지정하면 member+assigned 에게서 숨는다.
      assigned_to: null,
      values: {
        [NOTICE_KEYS.body]: input.body ?? "",
        [NOTICE_KEYS.category]: input.categoryId ?? null,
        [NOTICE_KEYS.pinned]: input.pinned ?? false,
        [NOTICE_KEYS.publishedAt]: input.publishedAt ?? todayKst(),
        [NOTICE_KEYS.endedAt]: input.endedAt ?? null,
        [NOTICE_KEYS.audience]: input.audienceId ?? null,
        [NOTICE_KEYS.author]: input.authorId ?? ctx.user.id,
      },
    });
    return this.toNotice(board.id, item, todayKst());
  }

  /** 부분 갱신 — 전달된 키만 반영한다(미전달 셀은 보존). */
  update(ctx: Ctx, noticeId: string, patch: NoticePatch): Notice {
    requireNoticeManager(ctx);
    const board = this.findBoard(ctx);
    if (!board) throw new NotFoundError("공지 보드가 없습니다");
    this.ensureColumns(ctx, board.id);

    // 기간은 부분 갱신이라도 최종 조합으로 검증한다(한쪽만 바꿔 뒤집히는 것 방지).
    const current = this.toNotice(
      board.id,
      this.boards.getItem(this.readCtx(ctx), board.id, noticeId),
      todayKst(),
    );
    assertPeriod(
      patch.publishedAt !== undefined ? patch.publishedAt : current.publishedAt,
      patch.endedAt !== undefined ? patch.endedAt : current.endedAt,
    );

    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (title === "") throw new NoticeRuleError("제목을 입력하세요");
      this.boards.updateItem(ctx, board.id, noticeId, { title });
    }

    const cells: Record<string, CellValue> = {};
    if (patch.body !== undefined) cells[NOTICE_KEYS.body] = patch.body;
    if (patch.categoryId !== undefined) cells[NOTICE_KEYS.category] = patch.categoryId;
    if (patch.pinned !== undefined) cells[NOTICE_KEYS.pinned] = patch.pinned;
    if (patch.publishedAt !== undefined) cells[NOTICE_KEYS.publishedAt] = patch.publishedAt;
    if (patch.endedAt !== undefined) cells[NOTICE_KEYS.endedAt] = patch.endedAt;
    if (patch.audienceId !== undefined) cells[NOTICE_KEYS.audience] = patch.audienceId;
    if (patch.authorId !== undefined) cells[NOTICE_KEYS.author] = patch.authorId;

    // setCells 는 {item, errors} 를 돌려준다(T05 B3 — 관대 + 인라인 피드백 정책).
    // 공지는 인라인 편집 화면이 아니라 서비스 API 라 피드백 지면이 없으므로,
    // 검증 실패를 조용히 삼키지 않고 거부한다(잘못된 분류 id 등).
    let item: ItemWithValues;
    if (Object.keys(cells).length > 0) {
      const res = this.boards.setCells(ctx, board.id, noticeId, cells);
      if (res.errors.length > 0) {
        throw new NoticeRuleError(res.errors.map((e) => `${e.label}: ${e.message}`).join(", "));
      }
      item = res.item;
    } else {
      item = this.boards.getItem(ctx, board.id, noticeId);
    }
    return this.toNotice(board.id, item, todayKst());
  }

  remove(ctx: Ctx, noticeId: string): void {
    requireNoticeManager(ctx);
    const board = this.findBoard(ctx);
    if (!board) throw new NotFoundError("공지 보드가 없습니다");
    this.boards.deleteItem(ctx, board.id, noticeId);
  }

  // ── 내부 ──

  /**
   * 읽기용 컨텍스트 — 담당범위만 넓힌다.
   *
   * 공지는 조직 전체 공람이고 담당자가 없다(assigned_to=null). 그래서 보드 엔진의
   * `member+assigned` 필터에 걸려 통째로 사라진다. 조직 경계(org.id)는 그대로 두고
   * 담당범위 축만 푼다 — 공지 보드 외의 데이터는 이 컨텍스트로 읽지 않는다.
   * 공지 단위의 열람 제한은 `isNoticeVisibleTo` 가 별도로 건다.
   */
  private readCtx(ctx: Ctx): Ctx {
    return ctx.scope === "all" ? ctx : { ...ctx, scope: "all" };
  }

  private toNotice(boardId: string, item: ItemWithValues, today: string): Notice {
    const categoryId = toNullableStr(item.values[NOTICE_KEYS.category]);
    const audienceId = toNullableStr(item.values[NOTICE_KEYS.audience]);
    const publishedAt = toNullableStr(item.values[NOTICE_KEYS.publishedAt]);
    const endedAt = toNullableStr(item.values[NOTICE_KEYS.endedAt]);
    return {
      id: item.id,
      boardId,
      title: item.title,
      body: toStr(item.values[NOTICE_KEYS.body]),
      categoryId,
      categoryLabel: categoryId ? (CATEGORY_LABELS.get(categoryId) ?? null) : null,
      pinned: toBool(item.values[NOTICE_KEYS.pinned]),
      publishedAt,
      endedAt,
      audienceId,
      audienceLabel: audienceId ? (AUDIENCE_LABELS.get(audienceId) ?? null) : null,
      status: noticeStatusOf(publishedAt, endedAt, today),
      authorId: toNullableStr(item.values[NOTICE_KEYS.author]),
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    };
  }
}

/** 공지 쓰기는 관리자(owner/admin)만. UI 뿐 아니라 서버 액션·API 도 여기서 막힌다. */
function requireNoticeManager(ctx: Ctx): void {
  if (!isManager(ctx.role)) {
    throw new NoticeForbiddenError("공지는 관리자만 작성·수정·삭제할 수 있습니다");
  }
}

/** 종료일이 게시일보다 앞서면 영원히 안 보이는 공지가 된다 — 만들지 못하게 막는다. */
function assertPeriod(publishedAt: string | null, endedAt: string | null): void {
  if (publishedAt !== null && endedAt !== null && endedAt < publishedAt) {
    throw new NoticeRuleError("종료일은 게시일보다 앞설 수 없습니다");
  }
}

export class NoticeRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoticeRuleError";
  }
}

/** 권한 부족 — 로그인은 했지만 공지를 쓸 자격이 없다(→ 403). */
export class NoticeForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoticeForbiddenError";
  }
}

/** 상단고정 → 게시일 최신(미지정 뒤) → 생성일 최신. */
export function compareNotices(a: Notice, b: Notice): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.publishedAt !== b.publishedAt) {
    if (a.publishedAt === null) return 1;
    if (b.publishedAt === null) return -1;
    return a.publishedAt < b.publishedAt ? 1 : -1;
  }
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

export function getNoticesService(): NoticesService {
  return new NoticesService();
}
