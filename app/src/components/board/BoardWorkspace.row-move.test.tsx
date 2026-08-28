// @vitest-environment jsdom
import { act } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,describe,expect,it,vi } from "vitest";

const actionMocks=vi.hoisted(()=>({moveRowAction:vi.fn()}));
vi.mock("@/app/(app)/boards/actions",async(importOriginal)=>({
  ...(await importOriginal<typeof import("@/app/(app)/boards/actions")>()),
  moveRowAction:actionMocks.moveRowAction,
}));
vi.mock("next/navigation",()=>({usePathname:()=>"/boards/board-1",useRouter:()=>({push:vi.fn(),replace:vi.fn(),refresh:vi.fn()}),useSearchParams:()=>new URLSearchParams()}));

import { BoardWorkspace } from "./BoardWorkspace";

let root:Root|null=null;
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(async()=>{actionMocks.moveRowAction.mockReset();if(root)await act(async()=>root?.unmount());root=null;document.body.replaceChildren();});
const group={id:"group-1",org_id:"org-1",board_id:"board-1",name:"대기",color:null,sort_order:0};
const rows=["A","B"].map((title,index)=>({id:`item-${index}`,org_id:"org-1",board_id:"board-1",group_id:"group-1",title,assigned_to:null,deal_id:null,sort_order:index,created_at:"",updated_at:"",values:{}}));
const board=(version:number)=>({id:"board-1",org_id:"org-1",name:"보드",icon:null,description:null,source:"user",is_system:false,sort_order:0,row_order_version:version});

function workspace(version:number,canMoveRows=true){return <BoardWorkspace board={board(version) as never} columns={[]} groups={[group as never]} rows={rows as never} columnOrder={{}} cellFlash={null} assigneeLabels={{}} canEditItems canMoveRows={canMoveRows}/>;}

describe("#602 BoardWorkspace row move fence",()=>{
  it("coalesces double entry and consumes a newer clean server version after pending",async()=>{
    let release!:(value:{ok:true;version:number;replayed:boolean})=>void;
    actionMocks.moveRowAction.mockImplementationOnce(()=>new Promise((resolve)=>{release=resolve;})).mockResolvedValueOnce({ok:true,version:9,replayed:false});
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async()=>root?.render(workspace(2)));
    const down=host.querySelector<HTMLButtonElement>('[aria-label="A 아래로 이동"]')!;
    await act(async()=>{down.click();down.click();await Promise.resolve();});
    expect(actionMocks.moveRowAction).toHaveBeenCalledTimes(1);
    expect((actionMocks.moveRowAction.mock.calls[0][0] as FormData).get("expectedVersion")).toBe("2");
    await act(async()=>root?.render(workspace(8)));
    await act(async()=>release({ok:true,version:3,replayed:false}));
    const nextDown=host.querySelector<HTMLButtonElement>('[aria-label="A 아래로 이동"]')!;
    await act(async()=>{nextDown.click();await Promise.resolve();});
    expect(actionMocks.moveRowAction).toHaveBeenCalledTimes(2);
    expect((actionMocks.moveRowAction.mock.calls[1][0] as FormData).get("expectedVersion")).toBe("8");
  });

  it("renders assigned-only sessions without any row move entry point",async()=>{
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async()=>root?.render(workspace(0,false)));
    expect(host.querySelector('[aria-label="A 아래로 이동"]')).toBeNull();
    expect(actionMocks.moveRowAction).not.toHaveBeenCalled();
  });

  it("rolls an optimistic move back and announces a stale failure",async()=>{
    actionMocks.moveRowAction.mockResolvedValueOnce({ok:false,stale:true,message:"다른 사용자가 먼저 순서를 바꿨어요."});
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async()=>root?.render(workspace(2)));
    await act(async()=>{host.querySelector<HTMLButtonElement>('[aria-label="A 아래로 이동"]')!.click();await Promise.resolve();});
    expect([...host.querySelectorAll<HTMLInputElement>('input[name="title"]')].map((input)=>input.value).filter(Boolean)).toEqual(["A","B"]);
    expect(host.textContent).toContain("다른 사용자가 먼저 순서를 바꿨어요");
  });

  it("retries an unknown outcome with the exact same request id",async()=>{
    actionMocks.moveRowAction.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ok:true,version:3,replayed:true});
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);await act(async()=>root?.render(workspace(2)));
    const down=()=>host.querySelector<HTMLButtonElement>('[aria-label="A 아래로 이동"]')!;
    await act(async()=>{down().click();await Promise.resolve();});
    await act(async()=>root?.render(workspace(8)));
    await act(async()=>{down().click();await Promise.resolve();});
    const first=actionMocks.moveRowAction.mock.calls[0][0] as FormData;const second=actionMocks.moveRowAction.mock.calls[1][0] as FormData;
    expect(first.get("requestId")).toBe(second.get("requestId"));expect(second.get("expectedVersion")).toBe("2");expect(host.textContent).toContain("이미 저장된 이동");
  });
});
