// @vitest-environment jsdom
import { act } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,describe,expect,it,vi } from "vitest";
import { BoardInlineTitleEditor } from "./BoardInlineTitleEditor";

let root:Root|null=null;
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(async()=>{if(root)await act(async()=>root?.unmount());root=null;document.body.replaceChildren();});
function inputValue(input:HTMLInputElement,value:string){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set?.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));}
async function render(save:(name:string)=>Promise<{ok:true;name:string}|{ok:false;message:string}>){const host=document.createElement("div");document.body.append(host);root=createRoot(host);await act(async()=>root?.render(<BoardInlineTitleEditor name="기존 이름" label="보드 이름" onSave={save}/>));return host;}

describe("BoardInlineTitleEditor",()=>{
  it("click focuses/selects and Enter or blur saves exactly once",async()=>{
    const save=vi.fn(async(name:string)=>({ok:true as const,name}));const host=await render(save);
    await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click());
    const input=host.querySelector<HTMLInputElement>("input")!;expect(document.activeElement).toBe(input);
    await act(async()=>{inputValue(input,"새 이름");input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));await Promise.resolve();});
    expect(save).toHaveBeenCalledTimes(1);expect(save).toHaveBeenCalledWith("새 이름");
  });
  it("Escape, empty and unchanged issue no request",async()=>{
    const save=vi.fn(async(name:string)=>({ok:true as const,name}));const host=await render(save);
    await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click());let input=host.querySelector<HTMLInputElement>("input")!;
    await act(async()=>input.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));expect(save).not.toHaveBeenCalled();
    await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click());input=host.querySelector("input")!;await act(async()=>{input.blur();await Promise.resolve();});expect(save).not.toHaveBeenCalled();
    await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click());input=host.querySelector("input")!;await act(async()=>{inputValue(input,"   ");input.blur();await Promise.resolve();});expect(save).not.toHaveBeenCalled();expect(host.querySelector('[role="alert"]')?.textContent).toContain("입력");
  });
  it("failure rolls back, announces, and allows a fresh retry",async()=>{
    const save=vi.fn().mockResolvedValueOnce({ok:false,message:"저장 실패"}).mockResolvedValueOnce({ok:true,name:"재시도"});const host=await render(save);
    await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click());let input=host.querySelector<HTMLInputElement>("input")!;
    await act(async()=>{inputValue(input,"실패 이름");input.blur();await Promise.resolve();});expect(host.querySelector('[role="alert"]')?.textContent).toBe("저장 실패");expect(host.textContent).toContain("기존 이름");
    await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click());input=host.querySelector("input")!;await act(async()=>{inputValue(input,"재시도");input.blur();await Promise.resolve();});expect(save).toHaveBeenCalledTimes(2);
  });
  it("coalesces Enter plus blur while one save is pending",async()=>{
    let release!:(value:{ok:true;name:string})=>void;
    const save=vi.fn(async()=>new Promise<{ok:true;name:string}>((resolve)=>{release=resolve;}));const host=await render(save);
    await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click());const input=host.querySelector<HTMLInputElement>("input")!;
    await act(async()=>{inputValue(input,"한 번만");input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));input.blur();await Promise.resolve();});
    expect(save).toHaveBeenCalledTimes(1);await act(async()=>release({ok:true,name:"한 번만"}));
    expect(host.textContent).toContain("한 번만");
    expect(host.textContent).not.toContain("기존 이름");
  });
  it("keeps the canonical result until a clean external prop refresh arrives",async()=>{
    const save=vi.fn(async()=>({ok:true as const,name:"서버 정본"}));const host=await render(save);
    await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click());const input=host.querySelector<HTMLInputElement>("input")!;
    await act(async()=>{inputValue(input,"요청 이름");input.blur();await Promise.resolve();});
    expect(host.textContent).toContain("서버 정본");
    await act(async()=>root?.render(<BoardInlineTitleEditor name="외부 최신 이름" label="보드 이름" onSave={save}/>));
    expect(host.textContent).toContain("외부 최신 이름");
  });
  it("releases a rejected promise and permits retry",async()=>{
    const save=vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ok:true,name:"복구 이름"});const host=await render(save);
    await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click());let input=host.querySelector<HTMLInputElement>("input")!;
    await act(async()=>{inputValue(input,"실패 이름");input.blur();await Promise.resolve();});
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("저장하지 못했어요");
    await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click());input=host.querySelector("input")!;
    await act(async()=>{inputValue(input,"복구 이름");input.blur();await Promise.resolve();});
    expect(save).toHaveBeenCalledTimes(2);expect(host.textContent).toContain("복구 이름");
  });
});
