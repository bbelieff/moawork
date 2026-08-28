// @vitest-environment jsdom
import { act } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,describe,expect,it,vi } from "vitest";

const mocks=vi.hoisted(()=>({moveRowAction:vi.fn(),moveItemAction:vi.fn(),reorderGroupsAction:vi.fn()}));
vi.mock("@/app/(app)/boards/actions",()=>mocks);
import { GenericBoardKanban,type KanbanLane } from "./GenericBoardKanban";

const row=(id:string,title:string,group:string)=>({id,org_id:"org-1",board_id:"board-1",group_id:group,title,assigned_to:null,deal_id:null,sort_order:0,created_at:"",updated_at:"",values:{}});
const lanes:KanbanLane[]=[
  {key:"group-1",label:"대기",color:null,items:[row("item-1","첫 행","group-1"),row("item-2","둘째 행","group-1"),row("item-3","셋째 행","group-1")]},
  {key:"group-2",label:"진행",color:null,items:[row("item-4","넷째 행","group-2")]},
];
let root:Root|null=null;
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(async()=>{mocks.moveRowAction.mockReset();mocks.moveItemAction.mockReset();if(root)await act(async()=>root?.unmount());root=null;document.body.replaceChildren();});
async function mount(groupBy="",extra:Record<string,unknown>={}){const host=document.createElement("div");document.body.append(host);root=createRoot(host);await act(async()=>root?.render(<GenericBoardKanban boardId="board-1" lanes={lanes} groupBy={groupBy} canMoveRows canManageSections rowOrderVersion={7} {...extra}/>));return host;}

describe("#602 generic kanban interactions",()=>{
  it("uses an atomic before-anchor for same-lane keyboard ordering and consumes the returned version",async()=>{
    mocks.moveRowAction.mockResolvedValue({ok:true,version:8,replayed:false});
    const host=await mount();
    await act(async()=>{host.querySelector<HTMLButtonElement>('[aria-label="첫 행 아래로 이동"]')!.click();await Promise.resolve();});
    const fd=mocks.moveRowAction.mock.calls[0][0] as FormData;
    expect(fd.get("beforeItemId")).toBe("item-3");expect(fd.get("expectedVersion")).toBe("7");expect(fd.get("requestId")).toBe(fd.get("eventKey"));
  });

  it("uses the same atomic before-anchor when pointer DnD crosses lanes",async()=>{
    mocks.moveRowAction.mockResolvedValue({ok:true,version:8,replayed:false});
    const host=await mount();
    const source=[...host.querySelectorAll("li")].find((node)=>node.textContent?.includes("첫 행"))!;
    const target=[...host.querySelectorAll("li")].find((node)=>node.textContent?.includes("넷째 행"))!;
    const dataTransfer={effectAllowed:"",dropEffect:""};
    const dragStart=new Event("dragstart",{bubbles:true,cancelable:true});Object.defineProperty(dragStart,"dataTransfer",{value:dataTransfer});
    const dragOver=new Event("dragover",{bubbles:true,cancelable:true});Object.defineProperty(dragOver,"dataTransfer",{value:dataTransfer});
    const drop=new Event("drop",{bubbles:true,cancelable:true});Object.defineProperty(drop,"dataTransfer",{value:dataTransfer});
    await act(async()=>{source.dispatchEvent(dragStart);target.dispatchEvent(dragOver);target.dispatchEvent(drop);await Promise.resolve();});
    const fd=mocks.moveRowAction.mock.calls[0][0] as FormData;
    expect(fd.get("groupId")).toBe("group-2");expect(fd.get("beforeItemId")).toBe("item-4");
  });

  it("keeps an unknown retry on the exact request id and never labels a failure as success",async()=>{
    mocks.moveRowAction.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ok:true,version:8,replayed:true});
    const host=await mount();const button=()=>host.querySelector<HTMLButtonElement>('[aria-label="첫 행 아래로 이동"]')!;
    await act(async()=>{button().click();await Promise.resolve();});
    expect(host.textContent).toContain("같은 이동을 다시 시도");
    await act(async()=>root?.render(<GenericBoardKanban boardId="board-1" lanes={lanes} groupBy="" canMoveRows canManageSections rowOrderVersion={12}/>));
    await act(async()=>{button().click();await Promise.resolve();});
    expect((mocks.moveRowAction.mock.calls[0][0] as FormData).get("requestId")).toBe((mocks.moveRowAction.mock.calls[1][0] as FormData).get("requestId"));
    expect((mocks.moveRowAction.mock.calls[1][0] as FormData).get("expectedVersion")).toBe("7");
    expect(host.textContent).toContain("이미 저장된 이동");
  });

  it("treats an unchanged lane selector as no intent and separates select-cell moves",async()=>{
    mocks.moveItemAction.mockResolvedValue({ok:false,stale:false,message:"선택 값을 저장하지 못했어요."});
    const host=await mount("status",{canMoveRows:false});const select=host.querySelector<HTMLSelectElement>('[aria-label="첫 행 이동할 레인"]')!;const form=select.closest("form")!;
    await act(async()=>{form.requestSubmit();await Promise.resolve();});
    expect(mocks.moveItemAction).not.toHaveBeenCalled();expect(host.textContent).toContain("현재 레인과 같아");
    select.value="group-2";
    await act(async()=>{form.requestSubmit();await Promise.resolve();});
    expect(mocks.moveItemAction).toHaveBeenCalledOnce();expect(mocks.moveRowAction).not.toHaveBeenCalled();expect(host.textContent).toContain("선택 값을 저장하지 못했어요");expect(host.querySelector('[role="alert"]')?.textContent).toContain("선택 값을 저장하지 못했어요");expect(host.textContent).not.toContain("행 이동을 저장했습니다");
  });

  it("fails system boards closed in every visible control",async()=>{
    const host=await mount("",{readOnly:true,isSystem:true});
    expect(host.querySelector('[aria-label="그룹 이름 편집"]')).toBeNull();expect(host.querySelector('[aria-label="첫 행 이동할 레인"]')).toBeNull();expect(host.querySelector('[draggable="true"]')).toBeNull();
  });
});
