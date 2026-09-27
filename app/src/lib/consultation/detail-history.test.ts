import { describe,expect,it } from "vitest";
import { consultationFeedEvent, type ConsultationFeedEvent } from "./detail-history";
import { canEditDetailEvent,canRemoveDetailEvent } from "@/lib/boards/detail-event-permissions";
import { detailEventAuthorName,isSelectableDetailEventKind } from "@/lib/boards/detail-event-kinds";
const base:ConsultationFeedEvent={id:"event-1",step:"contract_sent",kind:"confirmed",before:false,after:true,actor_id:"actor",at:"2026-09-26T02:00:00Z",details:null};
describe("readonly consultation handoff history",()=>{
  it("shows explicit checkbox before/after and keeps identity/actor/time",()=>{
    expect(consultationFeedEvent(base,[])).toEqual({id:"consultation:event-1",kind:"consultation",body:"계약서 송부: 미확인 → 확인",actor_id:"actor",created_at:base.at});
    expect(consultationFeedEvent({...base,kind:"invalidated",before:true,after:false,step:"deposit_confirmed"},[]).body).toBe("착수금 입금 확인: 확인 → 미확인 (앞 단계 취소)");
  });
  it("shows seal before/after rather than empty consultation phase fields",()=>{
    expect(consultationFeedEvent({...base,kind:"seal_approved",details:{before:{deal:null,board:"완료"},after:{deal:"완료",board:"완료"}}},[]).body).toBe("직인 승인: 대기 → 완료");
  });
  it("shows changed owner, phase and KST appointment without leaking identifiers",()=>{
    const event={...base,step:"phase",kind:"phase_changed",details:{before:{phase:"information",assigneeId:"old",meetingAt:null},after:{phase:"scheduled",assigneeId:"new",meetingAt:"2026-09-28T02:00:00Z"}}};
    const body=consultationFeedEvent(event,[{id:"old",name:"이전 담당"},{id:"new",name:"새 담당"}]).body;
    expect(body).toContain("정보수집");expect(body).toContain("이전 담당 → 새 담당");expect(body).toContain("11:00");expect(body).not.toContain("assigneeId");
  });
  it("is attributed to the actor and remains uneditable/unremovable even for the owner",()=>{
    const viewer={viewerId:"actor",viewerRole:"owner",assignedTo:"actor"};
    expect(detailEventAuthorName("consultation","담당 이름")).toBe("담당 이름");
    expect(canEditDetailEvent({kind:"consultation",actorId:"actor"},viewer)).toBe(false);
    expect(canRemoveDetailEvent({kind:"consultation",actorId:"actor"},viewer)).toBe(false);
    expect(isSelectableDetailEventKind("consultation")).toBe(false);
  });
});
