/**
 * 히스토리 한 줄의 «성격» (#662).
 *
 * ## 아바타는 사람, 배지는 성격
 *
 * 전에는 아바타 글자가 「메」「통」이었다. 같은 사람이 메모를 남기면 「메」, 전화를 하면 「통」 —
 * **한 사람이 두 얼굴로 보였다.** 아바타는 «누가» 이고 배지가 «무엇» 이다. 둘을 섞지 않는다.
 *
 * ## 고를 수 있는 넷, 뜨는 다섯
 *
 *     고른다   메모 · 통화 · 행정 · 미팅
 *     뜬다     그 넷 + 자동(field_change)
 *
 * `field_change` 는 시스템이 남기는 기록이라 사람이 고를 수 없다. DB 도 같다 —
 * `supabase/migrations/143_issue662_detail_event_kinds.sql` 의 가드가 넷만 받는다.
 * 그래서 이 파일의 두 목록이 «서로 다른 것» 이 맞다.
 *
 * ## 왜 컴포넌트 밖인가
 *
 * 안에 두면 검사할 자리가 없어진다(#638). 여기는 DOM 을 모른다 — 문자열만 받고 돌려준다.
 */

/** 사람이 고를 수 있는 성격. 순서가 곧 화면의 왼→오 순서이고, 미끄러지는 표시자의 칸 번호다. */
export const SELECTABLE_DETAIL_EVENT_KINDS = [
  "memo",
  "call",
  "admin",
  "meeting",
] as const;

export type SelectableDetailEventKind =
  (typeof SELECTABLE_DETAIL_EVENT_KINDS)[number];

/** 배지에 뜨는 성격 — 고를 수 있는 넷 + 시스템이 남기는 하나. */
export type DetailEventKind = SelectableDetailEventKind | "field_change";

const LABELS: Record<DetailEventKind, string> = {
  memo: "메모",
  call: "통화",
  admin: "행정",
  meeting: "미팅",
  field_change: "자동",
};

export function isSelectableDetailEventKind(
  value: string,
): value is SelectableDetailEventKind {
  return (SELECTABLE_DETAIL_EVENT_KINDS as readonly string[]).includes(value);
}

/**
 * 배지에 적을 말.
 *
 * ★ 모르는 값이면 「기록」이라고 적는다. 나중에 DB 에 성격이 하나 더 늘어났을 때
 *   화면이 빈칸이 되거나 영어 코드가 그대로 보이는 것보다 낫다.
 */
export function detailEventKindLabel(value: string): string {
  return LABELS[value as DetailEventKind] ?? "기록";
}

/** 미끄러지는 표시자가 설 칸. 고를 수 없는 값이면 첫 칸. */
export function detailEventKindIndex(value: string): number {
  const index = (SELECTABLE_DETAIL_EVENT_KINDS as readonly string[]).indexOf(
    value,
  );
  return index < 0 ? 0 : index;
}

/**
 * 줄 머리에 적을 이름.
 *
 * 자동 기록은 사람이 남긴 것이 아니다 — 담당자 이름을 적으면 「그 사람이 손으로 바꿨다」로 읽힌다.
 */
export function detailEventAuthorName(
  kind: string,
  actorName: string | null | undefined,
): string {
  if (kind === "field_change") return "자동 기록";
  return actorName?.trim() || "담당자";
}

/**
 * 담당자 아바타 글자 — **같은 사람이면 항상 같다.**
 *
 * ★ `Array.from` 으로 자른다. `name[0]` 은 이모지나 일부 한자에서 글자를 반쪽으로 자른다
 *   (서로게이트 쌍). 이름은 사용자가 적는 값이라 무엇이든 들어올 수 있다.
 */
export function detailEventActorInitial(
  actorName: string | null | undefined,
): string {
  const trimmed = actorName?.trim() ?? "";
  if (!trimmed) return "담";
  return Array.from(trimmed)[0] ?? "담";
}
