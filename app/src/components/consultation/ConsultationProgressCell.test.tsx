// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consultationActions = vi.hoisted(() => ({
  readSnapshot: vi.fn(),
  readHandoff: vi.fn(),
  mutateWorkflow: vi.fn(),
}));

vi.mock("@/lib/consultation/actions", () => ({
  mutateConsultationWorkflow: consultationActions.mutateWorkflow,
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

// ★ 167: 계약 진행 칸은 과거 체크리스트가 아니라 계약금(1단계)·직인(2단계)으로 읽는다.
function entryOf(input: Readonly<{ phase?: string; fee?: boolean; seal?: boolean; absentFrom?: string; mode?: string }> = {}) {
  const keys = ["contract_sent", "signed_copy_sent", "counterparty_signature_confirmed", "deposit_confirmed"] as const;
  return boardEntryFromRow({
    item_id: "item-1",
    deal_id: "deal-1",
    company_id: null,
    mode: input.mode ?? "remote",
    version: 2,
    meeting_at: null,
    phase: input.phase,
    absent_from_phase: input.absentFrom ?? null,
    checklist: Object.fromEntries(keys.map((key) => [key, { confirmed: false, actor: null, at: null }])),
    contract_fee_ready: input.fee === true,
    seal_done: input.seal === true,
    ready: false,
    missing: ["계약금 입금 확인"],
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
  it.each([
    [{ fee: false, seal: false }, "1단계 · 계약금 입금 확인"],
    [{ fee: false, seal: true }, "1단계 · 계약금 입금 확인"],
    [{ fee: true, seal: false }, "2단계 · 직인"],
    [{ fee: true, seal: true }, "계약 확인 완료"],
  ] as const)("167: 계약 진행 %o 는 «%s» 로 읽는다", async (state, label) => {
    await act(async () => {
      root!.render(
        <ConsultationProgressCell itemId="item-1" title="테스트 건" entry={entryOf({ phase: "contract", ...state })} />,
      );
    });
    expect(container!.querySelector("p")!.textContent).toBe(label);
    expect(container!.querySelector(".sr-only")!.textContent?.trim()).toBe("계약금 입금 확인 → 직인");
    expect(container!.innerHTML).toContain("확인 열기");
    expect(container!.textContent).not.toMatch(/\d\/4|4단계/);
  });

  it("167: 부재는 어느 단계에서 왔는지 함께 읽는다", async () => {
    await act(async () => root!.render(<ConsultationProgressCell itemId="item-1" title="상담 건" entry={entryOf({ phase: "absent", absentFrom: "scheduled" })} />));
    expect(container!.querySelector("p")!.textContent).toBe("부재 · 상담예정에서");
  });

  it("unstarted legacy row shows its actual phase, not contract zero of four", async () => {
    await act(async () => root!.render(<ConsultationProgressCell itemId="item-1" title="상담 건" entry={entryOf()} />));
    expect(container!.textContent).toContain("정보수집");
    expect(container!.textContent).not.toContain("계약 0/4");
  });

});


describe("consultation opens the shared item detail", () => {
  const members=[{id:"user-1",label:"김담당"},{id:"user-2",label:"이담당"}];
  let phase:string;
  let version:number;
  beforeEach(()=>{
    phase="information"; version=0;
    consultationActions.readSnapshot.mockImplementation(async()=>({ok:true,snapshot:{
      itemId:"item-1",dealId:"deal-1",companyId:null,boardSource:"core.default-tab/contact",stage:"remote",phase,version,
      meetingAt:"2026-09-28T02:00:00.000Z",assigneeId:"user-1",dealStageKind:"meeting",ready:false,missing:[],seal:{approved:false,detail:""},
      contractFee:{status:null,ready:false},
      checklist:Object.fromEntries(["contract_sent","signed_copy_sent","counterparty_signature_confirmed","deposit_confirmed"].map((key)=>[key,{confirmed:false,actorId:null,at:null}]))
    }}));
    consultationActions.readHandoff.mockResolvedValue({ok:true,ready:false,missing:[],message:""});
    consultationActions.mutateWorkflow.mockImplementation(async(_prev,form:FormData)=>{
      if (Number(form.get("expectedVersion"))!==version) return {ok:false,message:"순서 오류"};
      phase=String(form.get("phase")); version+=1;
      return {ok:true,message:"상담 기록을 저장했습니다.",version};
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
      <ConsultationProgressCell itemId="item-1" title="대한정밀" entry={entryOf({phase})} members={members} />
      {detail()}
    </div>{detail("item-other")}</>));
  }
  const opener=()=>container!.querySelector<HTMLButtonElement>('[aria-label="대한정밀 상담 확인 열기"]')!;
  const phaseSelect=()=>document.querySelector<HTMLSelectElement>('[data-item-detail-consultation] [aria-label="상담 단계"]')!;
  const saveButton=()=>[...document.querySelectorAll<HTMLButtonElement>('[data-item-detail-consultation] button')].find(b=>b.textContent==="단계 저장")!;
  async function savePhase(next:string){
    await act(async()=>{ phaseSelect().value=next; phaseSelect().dispatchEvent(new Event("change",{bubbles:true})); });
    await act(async()=>saveButton().click());
  }
  it("sequential phase saves stay in one shared detail through every group remount", async()=>{
    await renderRow(); await act(async()=>opener().click());
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(window.location.hash).toBe("#item-item-1");
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("대한정밀");
    expect(document.querySelector<HTMLInputElement>('input[name="meetingAt"]')!.value).not.toBe("");
    expect(document.querySelector<HTMLSelectElement>('select[name="assigneeId"]')!.value).toBe("user-1");
    const steps=["consulting","absent","on_hold","contract"];
    for(let i=0;i<steps.length;i+=1){
      await savePhase(steps[i]);
      await renderRow(i+1);
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      expect(phaseSelect().value).toBe(steps[i]);
    }
    expect(consultationActions.mutateWorkflow).toHaveBeenCalledTimes(4);
    expect((consultationActions.mutateWorkflow.mock.calls.map(([,form])=>(form as FormData).get("expectedVersion")))).toEqual(["0","1","2","3"]);
    expect(container!.textContent).toContain("1단계 · 계약금 입금 확인");
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
    consultationActions.mutateWorkflow.mockResolvedValueOnce({ok:false,message:"잠시 후 다시 시도해 주세요."});
    await savePhase("consulting");
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
