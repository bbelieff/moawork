// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SavedTableSelection } from "./SavedTableSelection";

const capture = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock("@/components/board/BulkActionBar", () => ({ BulkActionBar: (props: Record<string, unknown>) => { capture.props = props; return <div data-testid="bulk" />; } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.replaceChildren(); capture.props = null; });
type Props = ComponentProps<typeof SavedTableSelection>;
const rows: Props["rows"] = ["A", "B", "C"].map((id, index) => ({ id, title: id, values: {}, org_id: "o", board_id: "b", group_id: null,
  assigned_to: null, deal_id: null, sort_order: index, created_at: "2026-09-27T00:00:00Z", updated_at: "2026-09-27T00:00:00Z" }));
async function setup(overrides: Partial<Omit<Props, "children">> = {}) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const render = async (shown: Props["rows"]) => act(async () => root.render(<SavedTableSelection boardId="b" rows={shown} columns={[]} members={[]} groups={[]}
    canEdit={false} canMove={false} canDelete={false} canExport={false} {...overrides}>
    {({ header, cell }) => <>{header}{shown.map((row) => <span key={row.id}>{cell(row)}</span>)}</>}
  </SavedTableSelection>));
  await render(rows); return { host, render };
}
describe("saved flat table selection", () => {
  it("picks the physical workflow status even when another select is first or status is hidden", async () => {
    const columns: Props["columns"] = ["biz_reg_type", "consult_status"].map((key, index) => ({
      id: key, key, label: key, org_id: "o", board_id: "b", type: "select", source: "in", rightPinned: false,
      sort_order: index, width: 100, move_rule_jsonb: null, is_readonly: false, options_jsonb: { options: [{ id: "상담 전", label: "상담 전" }] },
    }));
    const { host } = await setup({ boardSource: "core.default-tab/new-lead", columns: [columns[0]], physicalColumns: columns });
    await act(async () => host.querySelector<HTMLInputElement>('[aria-label="A 선택"]')!.click());
    expect(capture.props?.statusColumn).toMatchObject({ key: "consult_status", options: [{ id: "상담 전", label: "통화대기" }] });
  });
  it("uses only visible rows after filtering and preserves denied action permissions", async () => {
    const { host, render } = await setup();
    await act(async () => host.querySelector<HTMLInputElement>('[aria-label="표의 전체 행 선택"]')!.click());
    expect((capture.props?.targets as { id: string }[]).map((row) => row.id)).toEqual(["A", "B", "C"]);
    await render([rows[1]]);
    expect((capture.props?.targets as { id: string }[]).map((row) => row.id)).toEqual(["B"]);
    expect(capture.props).toMatchObject({ totalSelected: 3, canEdit: false, canDelete: false, canExport: false });
  });
  it("supports shift ranges and an indeterminate master checkbox", async () => {
    const { host } = await setup();
    await act(async () => host.querySelector<HTMLInputElement>('[aria-label="A 선택"]')!.click());
    expect(host.querySelector<HTMLInputElement>('[aria-label="표의 전체 행 선택"]')!.indeterminate).toBe(true);
    await act(async () => host.querySelector<HTMLInputElement>('[aria-label="C 선택"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })));
    expect((capture.props?.targets as { id: string }[]).map((row) => row.id)).toEqual(["A", "B", "C"]);
    expect(host.querySelector<HTMLInputElement>('[aria-label="표의 전체 행 선택"]')!.checked).toBe(true);
  });
});
