/** Same-row entry points share the existing detail drawer and its history. */
export const ITEM_DETAIL_OPEN_EVENT = "moawork:item-detail-open";

export type ItemDetailOpenRequest = Readonly<{
  itemId: string;
  opener?: HTMLElement;
  /** #845 개선안 — 행 우클릭 「업체명 바꾸기」: 상세를 열고 제목을 바로 고치는 칸으로 둔다. */
  editTitle?: boolean;
}>;

export function requestItemDetailOpen(
  itemId: string,
  opener?: HTMLElement,
  options: { editTitle?: boolean } = {},
) {
  window.dispatchEvent(new CustomEvent<ItemDetailOpenRequest>(ITEM_DETAIL_OPEN_EVENT, {
    detail: { itemId, opener, editTitle: options.editTitle === true },
  }));
}
