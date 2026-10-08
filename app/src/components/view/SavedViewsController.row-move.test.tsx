// @vitest-environment jsdom
import { act } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

const actions=vi.hoisted(()=>({moveRowAction:vi.fn(),reorderGroupsAction:vi.fn()}));
vi.mock("@/app/(app)/boards/actions",()=>actions);
vi.mock("@/app/(app)/boards/title-actions",()=>({renameColumnTitleAction:vi.fn()}));
// 보기 줄은 보기 방식을 router.push 로 바꾼다 — 앱 라우터 밖에서 그리므로 바꿔 끼운다.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));
import { SavedViewsController } from "./SavedViewsController";

const group={id:"group-1",org_id:"org-1",board_id:"board-1",name:"대기",color:null,sort_order:0};
const rows=["A","B"].map((title,index)=>({id:`item-${index}`,org_id:"org-1",board_id:"board-1",group_id:"group-1",title,assigned_to:null,deal_id:null,sort_order:index,created_at:"",updated_at:"",values:{}}));
let root:Root|null=null;
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>{window.history.replaceState({},"","/boards/board-1?view=flat");vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({data:[]})})));});
afterEach(async()=>{actions.moveRowAction.mockReset();vi.unstubAllGlobals();if(root)await act(async()=>root?.unmount());root=null;document.body.replaceChildren();});
async function mount(version=2){const host=document.createElement("div");document.body.append(host);root=createRoot(host);await act(async()=>{root?.render(<SavedViewsController boardId="board-1" orgId="org-1" currentUserId="user-1" rows={rows as never} groups={[group as never]} renderMode="flat" canEditItems canMoveRows rowOrderVersion={version}/>);await Promise.resolve();});return host;}

describe("#602 flat atomic row move",()=>{
  it("work flat view forwards canonical ownership without reading stale person EAV",async()=>{
    const owner={id:"owner",org_id:"org-1",board_id:"board-1",key:"owner",label:"담당자",type:"person",source:"act",rightPinned:false,options_jsonb:null,width:120,sort_order:0};
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async()=>{root?.render(<SavedViewsController boardId="board-1" orgId="org-1" currentUserId="actor"
      boardSource="core.default-tab/contract-work" columns={[owner as never]} rows={[{...rows[0],assigned_to:"actor",deal_id:"deal-1",values:{owner:"stale"}}] as never}
      memberOptions={[{id:"actor",label:"현재 담당"},{id:"stale",label:"이전 담당"}]} renderMode="flat" canEditItems/>);await Promise.resolve();});
    expect(host.textContent).toContain("현재 담당");expect(host.textContent).not.toContain("미배정");
    expect(host.querySelector('input[name="kind"][value="person"]')).toBeNull();
  });
  it("retains the exact request id after an unknown result and consumes the returned version",async()=>{
    actions.moveRowAction.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ok:true,version:8,replayed:true}).mockResolvedValueOnce({ok:true,version:9,replayed:false});
    const host=await mount();const down=()=>host.querySelector<HTMLButtonElement>('[aria-label="A 아래로 이동"]')!;
    await act(async()=>{down().click();await Promise.resolve();});
    await act(async()=>{root?.render(<SavedViewsController boardId="board-1" orgId="org-1" currentUserId="user-1" rows={rows as never} groups={[group as never]} renderMode="flat" canEditItems canMoveRows rowOrderVersion={12}/>);await Promise.resolve();});
    await act(async()=>{down().click();await Promise.resolve();});
    const first=actions.moveRowAction.mock.calls[0][0] as FormData;const retry=actions.moveRowAction.mock.calls[1][0] as FormData;
    expect(first.get("requestId")).toBe(retry.get("requestId"));expect(retry.get("expectedVersion")).toBe("2");
    await act(async()=>{down().click();await Promise.resolve();});
    const next=actions.moveRowAction.mock.calls[2][0] as FormData;expect(next.get("requestId")).not.toBe(retry.get("requestId"));expect(next.get("expectedVersion")).toBe("12");
  });
  it("exposes no rename or structural keyboard command for a grouped credit presentation",async()=>{
    const base={org_id:"org-1",board_id:"board-1",type:"number",source:"in",rightPinned:false,options_jsonb:null,width:120,move_rule_jsonb:null,is_readonly:false};
    const columns=[{...base,id:"ncb",key:"credit_score_ncb",label:"NCB",sort_order:0},{...base,id:"kcb",key:"credit_score_kcb",label:"KCB",sort_order:1}];
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);await act(async()=>{root?.render(<SavedViewsController boardId="board-1" orgId="org-1" currentUserId="user-1" columns={columns as never} rows={[{...rows[0],values:{credit_score_ncb:700,credit_score_kcb:710}}] as never} renderMode="flat" canonicalNewLead canManageColumns/>);await Promise.resolve();});
    expect(host.textContent).toContain("신용점수");expect(host.querySelector('[aria-label="신용점수 컬럼 이름 편집"]')).toBeNull();expect(host.querySelector('[aria-label="신용점수 왼쪽으로 이동"]')).toBeNull();expect(host.querySelector('[aria-label="신용점수 오른쪽으로 이동"]')).toBeNull();
  });
});
