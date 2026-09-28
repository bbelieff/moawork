/** Same-row entry points share the existing detail drawer and its history. */
export const ITEM_DETAIL_OPEN_EVENT = "moawork:item-detail-open";

export type ItemDetailOpenRequest = Readonly<{ itemId: string; opener?: HTMLElement }>;

export function requestItemDetailOpen(itemId: string, opener?: HTMLElement) {
  window.dispatchEvent(new CustomEvent<ItemDetailOpenRequest>(ITEM_DETAIL_OPEN_EVENT, {
    detail: { itemId, opener },
  }));
}
