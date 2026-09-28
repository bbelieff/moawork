// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupTable } from "./GroupTable";
import type { ItemWithValues } from "@/lib/boards/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = null; document.body.replaceChildren(); });
const row: ItemWithValues = {
  id: "target", org_id: "org", board_id: "board", group_id: "physical-group", title: "대상",
  assigned_to: null, deal_id: null, sort_order: 0, created_at: "2026-09-27T00:00:00Z",
  updated_at: "2026-09-27T00:00:00Z", values: {},
};
async function mount(enabled: boolean, allowed = () => true) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const onDrop = vi.fn();
  await act(async () => root!.render(<GroupTable boardId="board" groupId={null}
    columns={[]} rows={[row]} readOnly={false} rowDragEnabled={enabled} cellFlash={null}
    onColumnDrop={() => {}} dragRowId="source-in-another-physical-group" canDropRow={allowed}
    onRowDragStart={() => {}} onRowDragEnd={() => {}} onRowDrop={onDrop} />));
  return { host, onDrop };
}
async function drag(target: Element, type: "dragover" | "drop") {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { dropEffect: "none" } });
  await act(async () => target.dispatchEvent(event));
  return event;
}
describe("GroupTable physical and virtual drop eligibility", () => {
  it.each([0, 1])("never calls the move callback for disabled virtual target row %i", async (index) => {
    const allowed = vi.fn(() => true);
    const { host, onDrop } = await mount(false, allowed);
    const target = host.querySelectorAll("tbody tr")[index];
    expect(target).toBeDefined();
    expect((await drag(target, "dragover")).defaultPrevented).toBe(false);
    expect((await drag(target, "drop")).defaultPrevented).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
    expect(allowed).not.toHaveBeenCalled();
  });
  it.each([0, 1])("keeps permitted physical row/footer drop %i working", async (index) => {
    const { host, onDrop } = await mount(true);
    const target = host.querySelectorAll("tbody tr")[index];
    expect((await drag(target, "dragover")).defaultPrevented).toBe(true);
    expect((await drag(target, "drop")).defaultPrevented).toBe(true);
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith(index);
  });
  it("rechecks the parent's current permission at drop after accepting dragover", async () => {
    let allowed = true;
    const { host, onDrop } = await mount(true, () => allowed);
    const target = host.querySelectorAll("tbody tr")[1];
    expect((await drag(target, "dragover")).defaultPrevented).toBe(true);
    allowed = false;
    expect((await drag(target, "drop")).defaultPrevented).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
  });
});
