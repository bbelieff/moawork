// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ItemWithValues } from "@/lib/boards/types";
import { EMPTY_FILTERS } from "./filters";
import { OtherInfoFacetFilters } from "./OtherInfoFacetFilter";
import { emptyOtherInfoValue, otherInfoFacetFilterKey, updateOtherInfoEntry } from "@/lib/boards/structured-field";

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("Issue #601 actual-column other-info facets", () => {
  it("counts and emits a namespaced key for the exact custom column", async () => {
    const value = updateOtherInfoEntry(emptyOtherInfoValue(), "certifications", { checked: true });
    const rows: ItemWithValues[] = [{
      id: "row-a", org_id: "org-a", board_id: "board-a", group_id: null, title: "A",
      assigned_to: null, deal_id: null, sort_order: 0, created_at: "", updated_at: "",
      values: { due_diligence: value, other_info: emptyOtherInfoValue() },
    }];
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(
      <OtherInfoFacetFilters
        rows={rows}
        columnKey="due_diligence"
        columnLabel="실사정보"
        qualifyLabel
        filters={EMPTY_FILTERS}
        onChange={onChange}
      />,
    ));
    const trigger = [...host.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]')]
      .find((button) => button.textContent?.includes("실사정보 · 보유인증"));
    expect(trigger).toBeDefined();
    if (!trigger) throw new Error("보유인증 facet trigger not found");
    await act(async () => trigger.click());
    const checkedLabel = [...document.body.querySelectorAll<HTMLLabelElement>('[data-filter-option]')]
      .find((label) => label.textContent?.includes("체크 (1)"));
    expect(checkedLabel).toBeDefined();
    if (!checkedLabel) throw new Error("checked facet option not found");
    const checked = checkedLabel.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checked).not.toBeNull();
    if (!checked) throw new Error("checked facet input not found");
    await act(async () => checked.click());
    expect(onChange).toHaveBeenCalledWith({
      ...EMPTY_FILTERS,
      byColumn: { [otherInfoFacetFilterKey("due_diligence", "certifications")]: ["true"] },
    });
    expect(onChange.mock.calls[0][0].byColumn).not.toHaveProperty(
      otherInfoFacetFilterKey("other_info", "certifications"),
    );
  });
});
