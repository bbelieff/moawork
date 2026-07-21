/**
 * 공지사항(core.notice) 도메인 타입 — T04.
 *
 * 저장은 **003 임의 보드 엔진**(boards/items/item_values EAV) 위에 얹는다.
 * 전용 테이블을 새로 만들지 않는다(ADR-0002: 스키마 정본은 001+002+003, 독자 마이그레이션 금지).
 *
 * 공지 보드 = `boards` 1행 + 고정 컬럼 5개. 각 공지 = `items` 1행 + `item_values` 셀.
 * `is_system=false` 로 둔다 — true 면 BoardsService 가 아이템 편집을 막아 CRUD 가 불가능해진다.
 */

import type { FieldOption } from "@/lib/types";
import type { NewColumn } from "@/lib/boards/store";

/** 공지 보드 식별자(003 boards.source). 시드가 이 값을 심는다. */
export const NOTICE_BOARD_SOURCE = "core.notice";

/**
 * 식별 폴백용 보드 이름.
 * 런타임 프로비저닝(ensureBoard)은 포트에 source 인자가 없어 source=null 로 생성되므로,
 * 이름으로도 공지 보드를 찾는다. (→ followup: BoardsRepo.createBoard 에 source 추가 요청)
 */
export const NOTICE_BOARD_NAME = "공지사항";

/** 공지 보드 고정 컬럼 key — item_values.column_key 와 1:1. */
export const NOTICE_KEYS = {
  body: "body",
  category: "category",
  pinned: "pinned",
  publishedAt: "published_at",
  author: "author",
} as const;

/** 분류 선택지 — 003 board_columns.options_jsonb 에 저장. */
export const NOTICE_CATEGORY_OPTIONS: FieldOption[] = [
  { id: "notice-general", label: "일반", color: "#579bfc", order: 0 },
  { id: "notice-important", label: "중요", color: "#e2445c", order: 1 },
  { id: "notice-event", label: "행사", color: "#00c875", order: 2 },
];

/** 공지 보드 컬럼 정의(프로비저닝 정본). 시드와 ensureBoard 가 함께 참조한다. */
export const NOTICE_COLUMNS: NewColumn[] = [
  { key: NOTICE_KEYS.body, label: "본문", type: "longtext", width: null },
  {
    key: NOTICE_KEYS.category,
    label: "분류",
    type: "select",
    options: NOTICE_CATEGORY_OPTIONS,
    width: 110,
  },
  { key: NOTICE_KEYS.pinned, label: "상단고정", type: "checkbox", width: 90 },
  { key: NOTICE_KEYS.publishedAt, label: "게시일", type: "date", width: 130 },
  { key: NOTICE_KEYS.author, label: "작성자", type: "person", width: 120 },
];

/** 화면/집계용 공지 뷰모델 — EAV 셀을 평탄화한 형태. */
export interface Notice {
  id: string;
  boardId: string;
  title: string;
  body: string;
  /** NOTICE_CATEGORY_OPTIONS 의 option id. 미지정이면 null. */
  categoryId: string | null;
  categoryLabel: string | null;
  pinned: boolean;
  /** YYYY-MM-DD. 미지정이면 null. */
  publishedAt: string | null;
  authorId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 공지 작성 입력. title 만 필수. */
export interface NewNotice {
  title: string;
  body?: string;
  categoryId?: string | null;
  pinned?: boolean;
  /** 미지정이면 서비스가 오늘(KST) 로 채운다. */
  publishedAt?: string | null;
  authorId?: string | null;
}

/** 공지 수정 입력 — 전달된 키만 반영한다(부분 갱신). */
export type NoticePatch = Partial<NewNotice>;
