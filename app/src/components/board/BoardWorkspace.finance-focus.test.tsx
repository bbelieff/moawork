// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NEW_LEAD_TAB_SOURCE } from "@/lib/default-tabs/types";
import type { BoardColumn } from "@/lib/boards/types";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/boards/board-a",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { BoardWorkspace } from "./BoardWorkspace";

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
});

function column(key: string, index: number, type: BoardColumn["type"] = "text"): BoardColumn {
  return {
    id: `column-${key}`, org_id: "org-a", board_id: "board-a", key,
    label: key, type, source: "in", rightPinned: false, options_jsonb: null,
    sort_order: index, width: null,
  };
}

async function renderWorkspace(source: string, columns: BoardColumn[], focus: string) {
  window.history.replaceState(null, "", `/boards/board-a?mwFocus=${focus}`);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(
    <BoardWorkspace
      board={{ id: "board-a", org_id: "org-a", name: "보드", description: null, icon: null, source, is_system: false, sort_order: 0 } as never}
      columns={columns}
      groups={[{ id: "group-a", org_id: "org-a", board_id: "board-a", name: "그룹", color: null, sort_order: 0 }] as never}
      rows={[{
        id: "item-a", org_id: "org-a", board_id: "board-a", group_id: "group-a", title: "회사",
        assigned_to: null, deal_id: null, sort_order: 0, created_at: "", updated_at: "",
        values: { credit_score_ncb: 812, credit_score_kcb: 745, revenue_band: "10억~30억", revenue_3y_million: 1234 },
      }] as never}
      columnOrder={{}}
      cellFlash={null}
      assigneeLabels={{}}
    />,
  ));
  await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
  return host.innerHTML;
}

describe("#602 saved focus projection", () => {
  it.each([
    ["credit_score_ncb", "credit_scores"],
    ["credit_score_kcb", "credit_scores"],
    ["revenue_band", "revenue_3y_million"],
    ["revenue_3y_million", "revenue_3y_million"],
  ])("canonical reload maps %s to logical %s highlight", async (physical, presentation) => {
    const html = await renderWorkspace(NEW_LEAD_TAB_SOURCE, [
      column("credit_score_ncb", 0, "number"),
      column("credit_score_kcb", 1, "number"),
      column("revenue_band", 2, "select"),
      column("revenue_3y_million", 3, "number"),
    ], physical);
    expect(html.match(/data-view-focus="true"/g)).toHaveLength(2);
    expect(html).toMatch(new RegExp(`data-view-focus="true"[^>]*data-column-key="${presentation}"|data-column-key="${presentation}"[^>]*data-view-focus="true"`));
  });

  it("custom board keeps its physical focus key unchanged", async () => {
    const html = await renderWorkspace("custom/board", [column("revenue_band", 0, "text")], "revenue_band");
    expect(html.match(/data-view-focus="true"/g)).toHaveLength(2);
    expect(html).toMatch(/data-view-focus="true"[^>]*data-column-key="revenue_band"|data-column-key="revenue_band"[^>]*data-view-focus="true"/);
  });
});
