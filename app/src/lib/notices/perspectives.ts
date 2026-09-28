import type { ItemWithValues } from "@/lib/boards/types";
import { NOTICE_KEYS } from "@/lib/notices/types";

export const NOTICE_PERSPECTIVES = ["all", "authored"] as const;
export type NoticePerspective = (typeof NOTICE_PERSPECTIVES)[number];

export function parseNoticePerspective(value: string | undefined): NoticePerspective {
  return NOTICE_PERSPECTIVES.includes(value as NoticePerspective)
    ? (value as NoticePerspective)
    : "all";
}

/**
 * 공지 기본 보드의 현재 저장 계약으로 증명할 수 있는 관점만 좁힌다.
 * audience는 기존 공지와 기본 보드에서 의미가 아직 하나로 정합화되지 않았으므로
 * 이 함수가 사람/부서 대상을 그럴듯하게 추측하지 않는다.
 */
export function applyNoticePerspective(
  rows: readonly ItemWithValues[],
  perspective: NoticePerspective,
  viewerUserId: string,
): ItemWithValues[] {
  if (perspective === "authored") {
    return rows.filter((row) => row.values[NOTICE_KEYS.author] === viewerUserId);
  }
  return [...rows];
}

/** 작성일은 별도 저장값이 아니라 canonical board item 생성시각의 화면 projection이다. */
export function projectNoticeMetadata(row: ItemWithValues): ItemWithValues {
  return {
    ...row,
    values: {
      ...row.values,
      created_on: row.created_at.slice(0, 10),
    },
  };
}
