// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consultationActions = vi.hoisted(() => ({
  readSnapshot: vi.fn(),
  readHandoff: vi.fn(),
  mutateChecklist: vi.fn(),
}));

vi.mock("@/lib/consultation/actions", () => ({
  mutateConsultationChecklist: consultationActions.mutateChecklist,
  mutateConsultationWorkflow: vi.fn(async () => ({ ok: false, message: "" })),
  mutateConsultationMode: vi.fn(async () => ({ ok: false, message: "" })),
  mutateConsultationSeal: vi.fn(async () => ({ ok: true, message: "승인 완료" })),
  mutateConsultationHandoff: vi.fn(async () => ({ ok: false, message: "" })),
  readConsultationSnapshot: consultationActions.readSnapshot,
  readConsultationHandoff: consultationActions.readHandoff,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { boardEntryFromRow } from "@/lib/consultation/boardView";
import { ConsultationProgressCell } from "./ConsultationProgressCell";
import { ConsultationPanel } from "./ConsultationPanel";
import { ItemDetailPanel } from "@/components/board/ItemDetailPanel";
import { ITEM_DETAIL_OPEN_EVENT, requestItemDetailOpen } from "@/lib/boards/item-detail-open";

function entryOf(confirmed: readonly boolean[], mode = "remote") {
  const keys = ["contract_sent", "signed_copy_sent", "counterparty_signature_confirmed", "deposit_confirmed"] as const;
  return boardEntryFromRow({
    item_id: "item-1",
    deal_id: "deal-1",
    company_id: null,
    mode,
    version: 2,
    meeting_at: null,
    checklist: Object.fromEntries(
      keys.map((key, index) => [
        key,
        confirmed[index]
          ? { confirmed: true, actor: "user-1", at: "2026-09-26T10:00:00+09:00" }
          : { confirmed: false, actor: null, at: null },
      ]),
    ),
    ready: false,
    missing: ["상대 서명 확인", "착수금 입금 확인"],
    seal_approved: false,
    seal_detail: "업무관리 이동을 먼저 선택해 주세요.",
    deal_stage_kind: "meeting",
  });
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
  if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  window.history.replaceState(null, "", "/");
  container = null;
  root = null;
  vi.unstubAllGlobals();
});

describe("ConsultationProgressCell", () => {
  it("표에서 진행 n/4 와 다음 단계를 읽는다", async () => {
    await act(async () => {
      root!.render(
        <ConsultationProgressCell itemId="item-1" title="테스트 건" entry={entryOf([true, true, false, false])} />,
      );
    });
    const html = container!.innerHTML;
    expect(html).toContain("계약 2/4");
    expect(html).toContain("다음: 상대 서명 확인");
    expect(html).toContain("확인 열기");
  });

  it("4완료면 완료로 읽힌다", async () => {
    await act(async () => {
      root!.render(
        <ConsultationProgressCell itemId="item-1" title="테스트 건" entry={entryOf([true, true, true, true])} />,
      );
    });
    expect(container!.innerHTML).toContain("4단계 완료");
  });

  it("unstarted legacy row shows its actual phase, not contract zero of four", async () => {
    await act(async () => root!.render(<ConsultationProgressCell itemId="item-1" title="상담 건" entry={entryOf([false,false,false,false])} />));
    expect(container!.textContent).toContain("정보수집");
    expect(container!.textContent).not.toContain("계약 0/4");
  });

});


describe("consultation opens the shared item detail", () => {
  const members=[{id:"user-1",label:"김담당"},{id:"user-2",label:"이담당"}];
  let confirmed:boolean[];
  let version:number;
  beforeEach(()=>{
    confirmed=[false,false,false,false]; version=0;
    consultationActions.readSnapshot.mockImplementation(async()=>({ok:true,snapshot:{
      itemId:"item-1",dealId:"deal-1",companyId:null,boardSource:"core.default-tab/contact",stage:"remote",phase:"contract",version,
      meetingAt:"2026-09-28T02:00:00.000Z",assigneeId:"user-1",dealStageKind:"meeting",ready:false,missing:[],seal:{approved:false,detail:""},
      checklist:Object.fromEntries(["contract_sent","signed_copy_sent","counterparty_signature_confirmed","deposit_confirmed"].map((key,i)=>[key,{confirmed:confirmed[i],actorId:confirmed[i]?"user-1":null,at:confirmed[i]?"2026-09-27T00:00:00Z":null}]))
    }}));
    consultationActions.readHandoff.mockResolvedValue({ok:true,ready:false,missing:[],message:""});
    consultationActions.mutateChecklist.mockImplementation(async(_prev,form:FormData)=>{
      const index=["contract_sent","signed_copy_sent","counterparty_signature_confirmed","deposit_confirmed"].indexOf(String(form.get("step")));
      if (Number(form.get("expectedVersion"))!==version || confirmed.slice(0,index).some(v=>!v)) return {ok:false,message:"순서 오류"};
      confirmed[index]=form.get("confirmed")==="true"; version+=1;
      return {ok:true,message:"확인했습니다.",version};
    });
  });
  function detail(itemId="item-1") {
    return <ItemDetailPanel boardId="board-1" boardName="비대면 상담" row={{
      id:itemId,org_id:"org-1",board_id:"board-1",group_id:"group-1",title:itemId==="item-1"?"대한정밀":"다른 회사",
      assigned_to:"user-1",deal_id:"deal-1",sort_order:0,created_at:"2026-09-27T00:00:00Z",updated_at:"2026-09-27T00:00:00Z",values:{}
    }} columns={[]} boardLayout={[]} layout={[]} inherited canEditItems canManageColumns={false}
    initialDetail={{ok:true,events:[],links:[],files:[],members:[]}}
    consultationSection={<ConsultationPanel itemId={itemId} title="대한정밀" initialMeetingAt="2026-09-28T02:00:00.000Z"
      currentAssigneeId="user-1" members={members} initialCompanyName="대한정밀" />} />;
  }
  async function renderRow(group=0) {
    await act(async()=>root!.render(<><div key={`group-${group}`}>
      <ConsultationProgressCell itemId="item-1" title="대한정밀" entry={entryOf(confirmed)} members={members} />
      {detail()}
    </div>{detail("item-other")}</>));
  }
  const opener=()=>container!.querySelector<HTMLButtonElement>('[aria-label="대한정밀 상담 확인 열기"]')!;
  const boxes=()=>[...document.querySelectorAll<HTMLInputElement>('[data-item-detail-consultation] input[type="checkbox"]')];
  it("four sequential confirmations stay in one shared detail through every group remount", async()=>{
    await renderRow(); await act(async()=>opener().click());
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(window.location.hash).toBe("#item-item-1");
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("대한정밀");
    expect(document.querySelector<HTMLInputElement>('input[name="meetingAt"]')!.value).not.toBe("");
    expect(document.querySelector<HTMLSelectElement>('select[name="assigneeId"]')!.value).toBe("user-1");
    for(let i=0;i<4;i+=1){
      await act(async()=>boxes()[i].click());
      await renderRow(i+1);
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      expect(boxes().slice(0,i+1).every(box=>box.checked)).toBe(true);
    }
    expect(consultationActions.mutateChecklist).toHaveBeenCalledTimes(4);
  });
  it("explicit rejection retains reservation/assignee drafts and returns focus to the consultation entry", async()=>{
    await renderRow(); await act(async()=>opener().click());
    const entry=opener();
    const date=document.querySelector<HTMLInputElement>('input[name="meetingAt"]')!;
    const assignee=document.querySelector<HTMLSelectElement>('select[name="assigneeId"]')!;
    await act(async()=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(date,"2026-10-01T10:00");
      date.dispatchEvent(new Event("input",{bubbles:true}));
      assignee.value="user-2"; assignee.dispatchEvent(new Event("change",{bubbles:true}));
    });
    consultationActions.mutateChecklist.mockResolvedValueOnce({ok:false,message:"잠시 후 다시 시도해 주세요."});
    await act(async()=>boxes()[0].click());
    expect(date.value).toBe("2026-10-01T10:00"); expect(assignee.value).toBe("user-2");
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    await act(async()=>{ window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})); await new Promise(resolve=>setTimeout(resolve,30)); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(entry);
  });
  it("only the matching item handles the request and every listener is removed on unmount", async()=>{
    const add=vi.spyOn(window,"addEventListener"); const remove=vi.spyOn(window,"removeEventListener");
    try {
      await renderRow(); await act(async()=>requestItemDetailOpen("missing-item"));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await act(async()=>requestItemDetailOpen("item-1",opener()));
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      const listeners=add.mock.calls.filter(([name])=>name===ITEM_DETAIL_OPEN_EVENT).map(([,listener])=>listener);
      await act(async()=>{root!.unmount();root=null;});
      for(const listener of listeners) expect(remove.mock.calls.some(([name,fn])=>name===ITEM_DETAIL_OPEN_EVENT&&fn===listener)).toBe(true);
      const reads=consultationActions.readSnapshot.mock.calls.length;
      requestItemDetailOpen("item-1");
      expect(consultationActions.readSnapshot).toHaveBeenCalledTimes(reads);
    } finally {add.mockRestore();remove.mockRestore();}
  });
});
