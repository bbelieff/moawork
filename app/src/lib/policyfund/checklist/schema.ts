import type { DealChecklistState } from "./types";

export function assertValidChecklistState(state: DealChecklistState): void {
  if ((state.productId !== null
      && (typeof state.productId !== "string" || state.productId.length < 1 || state.productId.length > 200))
    || !Array.isArray(state.items) || state.items.length > 200) {
    throw new Error("case checklist schema invalid");
  }
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const item of state.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)
      || Object.keys(item).sort().join(",") !== "checked,id,label,order"
      || typeof item.id !== "string" || item.id.length < 1 || item.id.length > 200
      || typeof item.label !== "string" || item.label.trim().length < 1 || item.label.length > 500
      || typeof item.checked !== "boolean"
      || !Number.isInteger(item.order) || item.order < 0 || item.order > 199
      || ids.has(item.id) || orders.has(item.order)) {
      throw new Error("case checklist schema invalid");
    }
    ids.add(item.id);
    orders.add(item.order);
  }
  if (state.items.some((_, index) => !orders.has(index))) throw new Error("case checklist schema invalid");
}

export function canonicalChecklistItems(items: DealChecklistState["items"]): DealChecklistState["items"] {
  return items.map((item) => ({
    id: item.id,
    label: item.label,
    checked: item.checked,
    order: item.order,
  }));
}
