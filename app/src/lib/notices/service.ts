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
import { BoardsService, NotFoundError } from "@/lib/boards";
import type { Board, CellValue, ItemWithValues } from "@/lib/boards/types";
import type { BoardsRepo } from "@/lib/boards/store";
import { getBoardsRepo } from "@/lib/repo/local/boardsRepo";
import {
  NOTICE_BOARD_NAME,
  NOTICE_BOARD_SOURCE,
  NOTICE_CATEGORY_OPTIONS,
  NOTICE_COLUMNS,
  NOTICE_KEYS,
  type NewNotice,
  type Notice,
  type NoticePatch,
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
    if (found) return found;

    const board = this.repo.createBoard(ctx, {
      name: NOTICE_BOARD_NAME,
      description: "조직 전체 공지 — 상단고정 공지가 먼저 보입니다",
      icon: "📢",
    });
    for (const col of NOTICE_COLUMNS) this.repo.createColumn(ctx, board.id, col);
    return board;
  }

  // ── 공지 CRUD ──

  /**
   * 공지 목록 — 상단고정 우선, 그다음 게시일 최신순(미지정은 뒤), 마지막으로 생성일 최신순.
   * 보드가 아직 없으면 빈 배열(프로비저닝을 강제하지 않는다 — 읽기는 부작용 없이).
   */
  list(ctx: Ctx, opts: { limit?: number } = {}): Notice[] {
    const board = this.findBoard(ctx);
    if (!board) return [];
    const notices = this.boards
      .listItems(ctx, board.id)
      .map((item) => this.toNotice(board.id, item))
      .sort(compareNotices);
    return opts.limit === undefined ? notices : notices.slice(0, Math.max(0, opts.limit));
  }

  get(ctx: Ctx, noticeId: string): Notice {
    const board = this.findBoard(ctx);
    if (!board) throw new NotFoundError("공지 보드가 없습니다");
    return this.toNotice(board.id, this.boards.getItem(ctx, board.id, noticeId));
  }

  create(ctx: Ctx, input: NewNotice): Notice {
    const board = this.ensureBoard(ctx);
    const title = input.title.trim();
    if (title === "") throw new NoticeRuleError("제목을 입력하세요");

    const item = this.boards.createItem(ctx, board.id, {
      title,
      // 공지는 조직 전체 공람 — 담당자를 지정하면 member+assigned 에게서 숨는다.
      assigned_to: null,
      values: {
        [NOTICE_KEYS.body]: input.body ?? "",
        [NOTICE_KEYS.category]: input.categoryId ?? null,
        [NOTICE_KEYS.pinned]: input.pinned ?? false,
        [NOTICE_KEYS.publishedAt]: input.publishedAt ?? todayKst(),
        [NOTICE_KEYS.author]: input.authorId ?? ctx.user.id,
      },
    });
    return this.toNotice(board.id, item);
  }

  /** 부분 갱신 — 전달된 키만 반영한다(미전달 셀은 보존). */
  update(ctx: Ctx, noticeId: string, patch: NoticePatch): Notice {
    const board = this.findBoard(ctx);
    if (!board) throw new NotFoundError("공지 보드가 없습니다");

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
    return this.toNotice(board.id, item);
  }

  remove(ctx: Ctx, noticeId: string): void {
    const board = this.findBoard(ctx);
    if (!board) throw new NotFoundError("공지 보드가 없습니다");
    this.boards.deleteItem(ctx, board.id, noticeId);
  }

  // ── 내부 ──
  private toNotice(boardId: string, item: ItemWithValues): Notice {
    const categoryId = toNullableStr(item.values[NOTICE_KEYS.category]);
    return {
      id: item.id,
      boardId,
      title: item.title,
      body: toStr(item.values[NOTICE_KEYS.body]),
      categoryId,
      categoryLabel: categoryId ? (CATEGORY_LABELS.get(categoryId) ?? null) : null,
      pinned: toBool(item.values[NOTICE_KEYS.pinned]),
      publishedAt: toNullableStr(item.values[NOTICE_KEYS.publishedAt]),
      authorId: toNullableStr(item.values[NOTICE_KEYS.author]),
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    };
  }
}

export class NoticeRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoticeRuleError";
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
