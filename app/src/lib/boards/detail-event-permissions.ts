/**
 * 히스토리 한 줄을 «치울 수» 있는가 (#672).
 *
 * ## 총괄 지시 그대로
 *
 *     회사 대표(owner)          전부
 *     담당자(그 아이템의 담당)   자동 기록(field_change) + 자기가 쓴 것
 *     그 밖의 협업자             자기가 쓴 것만
 *
 * ## ★ 이것은 «화면을 그리기 위한» 판정이다. 막는 것은 서버다.
 *
 * 같은 규칙이 `supabase/migrations/144_issue672_detail_event_remove.sql` 의
 * `remove_board_item_detail_event` 안에 있고, **그쪽이 정본이다.**
 * 여기 있는 것은 「버튼을 보일까 말까」를 정하기 위한 사본이다 —
 * 버튼을 감추는 것만으로는 아무것도 막지 못한다. 요청은 손으로 만들 수 있다.
 *
 * 그래도 사본을 두는 이유: **못 누를 버튼을 보여 주지 않기 위해서다.**
 * 회색 버튼을 두면 눌러 보고 실패하는 길을 만드는 셈이다.
 *
 * ## 왜 컴포넌트 밖인가
 *
 * 안에 두면 검사할 자리가 없어진다(#638). 여기는 DOM 을 모른다.
 */

export type DetailEventViewer = Readonly<{
  /** 보고 있는 사람. 로그인 전이면 null. */
  viewerId: string | null;
  /** 그 조직에서의 자리. 모르면 null — 그때는 «본인 글만» 으로 좁혀 둔다. */
  viewerRole: string | null;
  /** 그 아이템의 담당자. 없으면 null. */
  assignedTo: string | null;
}>;

export type RemovableDetailEvent = Readonly<{
  kind: string;
  actorId: string | null;
}>;

export function canRemoveDetailEvent(
  event: RemovableDetailEvent,
  viewer: DetailEventViewer,
): boolean {
  const { viewerId, viewerRole, assignedTo } = viewer;
  if (!viewerId) return false;

  // 대표는 전부.
  if (viewerRole === "owner") return true;

  // 누구나 «자기가 쓴 것».
  //
  // ★ actorId 가 null 인 것을 «내 것» 으로 세지 않는다. 자동 기록의 actor 가 비어 있는데
  //   viewerId 도 비었다면 둘 다 null 이라 같아져 버린다 — 위에서 viewerId 를 먼저 막은 이유다.
  if (event.actorId && event.actorId === viewerId) return true;

  // 담당자는 «자동 기록» 도. 자동 기록은 쓴 사람이 없으므로
  // 그 아이템을 책임지는 사람이 유일하게 판단할 수 있는 자리다.
  if (assignedTo && assignedTo === viewerId && event.kind === "field_change") return true;

  return false;
}

/**
 * 되살릴 수 있는가.
 *
 * ★ 치우는 것과 같게 두지 않는다. 남이 치운 것을 아무나 되살리면 「치웠다」가 의미를 잃는다.
 *   치운 사람 본인과 대표만이다.
 */
export function canRestoreDetailEvent(
  deletedBy: string | null,
  viewer: DetailEventViewer,
): boolean {
  if (!viewer.viewerId) return false;
  if (viewer.viewerRole === "owner") return true;
  return Boolean(deletedBy && deletedBy === viewer.viewerId);
}
