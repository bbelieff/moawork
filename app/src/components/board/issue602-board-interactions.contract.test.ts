import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,expect,it } from "vitest";
const read=(file:string)=>readFileSync(resolve(process.cwd(),"src/components/board",file),"utf8");
const readBoards=(file:string)=>readFileSync(resolve(process.cwd(),"src/components/boards",file),"utf8");
const readPage=()=>readFileSync(resolve(process.cwd(),"src/app/(app)/boards/[id]/page.tsx"),"utf8");
describe("Issue #602 final board interaction wiring",()=>{
  it("keeps the header action rail outside horizontal scroll and group add out of colspan",()=>{
    const header=read("BoardHeader.tsx");const table=read("GroupTable.tsx");
    expect(header.indexOf('className="mw-board-inline-scroll')).toBeLessThan(header.indexOf("data-board-action-rail"));
    expect(header).toContain("overflow-x-auto");expect(header).toContain("bg-mw-card");
    expect(table.slice(table.indexOf("!readOnly && ("))).not.toMatch(/colSpan=\{colSpan\}[\s\S]*NewLeadIntakeForm/);
  });
  it("removes row, column and group grip glyphs and exposes keyboard moves",()=>{
    const combined=[read("GroupBlock.tsx"),read("GroupTable.tsx")].join("\n");
    expect(combined).not.toContain("⠿");
    expect(combined).toContain("위로 이동");expect(combined).toContain("아래로 이동");expect(combined).toContain("그룹으로 이동");
    expect(combined).toContain("cursor-grab");expect(combined).toContain("cursor-not-allowed");expect(combined).toContain('aria-live="polite"');
    expect(combined).toContain("onOrderDragEnd");
    expect(combined).toContain("window.addEventListener(\"dragend\"");
    expect(combined).toContain("[contenteditable=true],[data-no-drag]");
    expect(read("GroupTable.tsx")).toContain("setOverRowIndex(null);setInvalidRowIndex(index)");
    expect(read("GroupTable.tsx")).toContain("data-no-drag");
  });
  it("uses one direct title editor and never adds a rename menu item",()=>{
    expect(read("BoardHeader.tsx")).toContain("BoardInlineTitleEditor");
    expect(read("GroupNameEditor.tsx")).toContain("BoardInlineTitleEditor");
    expect(read("GroupTable.tsx")).toContain("BoardInlineTitleEditor");
    expect(read("ColumnContextMenu.tsx")).not.toContain("이름 바꾸기");
  });
  it("keeps generic kanban on the same tokens and atomic physical-group move contract",()=>{
    const kanban=readBoards("GenericBoardKanban.tsx");
    expect(kanban).not.toContain("zinc-");expect(kanban).toContain("border-mw-line");expect(kanban).toContain('fd.set("expectedVersion"');
    expect(kanban).toContain("pendingRef.current");expect(kanban).toContain("intentRef.current");expect(kanban).toContain("beforeItemId");expect(kanban).toContain("moveRowAction");expect(kanban).toContain("GroupNameEditor");
    expect(readPage()).toContain("reorderColumnsAction");
  });
});
