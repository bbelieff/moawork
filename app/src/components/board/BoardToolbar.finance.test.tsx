// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardColumn } from "@/lib/boards/types";
import { EMPTY_FILTERS } from "./filters";
import { BoardToolbar } from "./BoardToolbar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
});

describe("#602 hidden legacy finance facet", () => {
  it("reload된 revenue_band를 visible clear chip으로 노출하고 그 predicate만 해제한다", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onChange = vi.fn();
    const columns: BoardColumn[] = [{
      id: "revenue", org_id: "org-a", board_id: "board-a",
      key: "revenue_3y_million", label: "3개년매출(백만원)", type: "number", source: "in",
      rightPinned: false, options_jsonb: null, sort_order: 0, width: null,
    }];
    await act(async () => root.render(
      <BoardToolbar
        columns={columns}
        rows={[]}
        filters={{
          ...EMPTY_FILTERS,
          byColumn: { revenue_band: ["10억~30억"], credit_score_ncb: ["812"] },
        }}
        onChange={onChange}
        matched={1}
        total={1}
        people={[]}
        legacyFacetLabels={{ revenue_band: "기존 매출구간" }}
      />,
    ));

    const clear = host.querySelector<HTMLButtonElement>('[aria-label="기존 매출구간 필터 해제"]');
    expect(clear).not.toBeNull();
    expect(host.textContent).toContain("10억~30억");
    await act(async () => clear?.click());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      byColumn: { revenue_band: [], credit_score_ncb: ["812"] },
    }));
    await act(async () => root.unmount());
  });
});
