// @vitest-environment jsdom
import { act } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,describe,expect,it,vi } from "vitest";
import { GroupBlock } from "./GroupBlock";

let root:Root|null=null;
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(async()=>{if(root)await act(async()=>root?.unmount());root=null;document.body.replaceChildren();});

describe("#602 GroupBlock drag lifecycle",()=>{
  it("clears cancelled drag state and never leaves a valid line on an invalid self target",async()=>{
    const start=vi.fn(),end=vi.fn(),drop=vi.fn();const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async()=>root?.render(<GroupBlock name="접수" color={null} columns={[]} rows={[]} presetName="" presetChanged={false} onOrderDragStart={start} onOrderDragEnd={end} onOrderDrop={drop} canOrderDrop={()=>false}><div/></GroupBlock>));
    const summary=host.querySelector("summary")!;
    await act(async()=>summary.dispatchEvent(new Event("dragstart",{bubbles:true})));expect(start).toHaveBeenCalledTimes(1);
    await act(async()=>summary.dispatchEvent(new Event("dragover",{bubbles:true})));expect(summary.className).toContain("cursor-not-allowed");expect(summary.className).not.toContain("border-t-2");
    await act(async()=>summary.dispatchEvent(new Event("dragend",{bubbles:true})));expect(end).toHaveBeenCalledTimes(1);expect(summary.className).not.toContain("cursor-not-allowed");expect(drop).not.toHaveBeenCalled();
  });
});
