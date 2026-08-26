import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, createClient, createRequestBoards, setCells, getDeal, getCompany, executeContactPipelineTransition } = vi.hoisted(() => ({
  getSession: vi.fn(), createClient: vi.fn(), createRequestBoards: vi.fn(), setCells: vi.fn(), getDeal: vi.fn(), getCompany: vi.fn(), executeContactPipelineTransition: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/boards/server", () => ({ createRequestBoards }));
vi.mock("@/lib/crm", () => ({ getCrmService: () => ({ getDeal, getCompany }) }));
vi.mock("./supabaseContactPipeline", () => ({ executeContactPipelineTransition }));

import { mutateContactPipeline } from "./contactPipelineActions";

describe("BBE-152 contact pipeline actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ org:{id:"org-1"} });
    createClient.mockResolvedValue({ rpc:vi.fn() });
    getDeal.mockResolvedValue({id:"deal-1",title:"새봄상사",custom:{seal_approval:"완료"}});
    getCompany.mockResolvedValue(undefined);
    setCells.mockResolvedValue({ errors: [] });
    createRequestBoards.mockResolvedValue({ service: { setCells } });
    executeContactPipelineTransition.mockResolvedValue({status:"committed",dealId:"deal-1",companyId:null,reason:null});
  });
  it("executes lead to contact through the same atomic boundary", async () => {
    const form=new FormData(); form.set("kind","lead_to_contact"); form.set("dealId","deal-1"); form.set("requestId","00000000-0000-4000-8000-000000000099");
    await expect(mutateContactPipeline({ok:false,message:""},form)).resolves.toEqual({ok:true,message:"리드컨택으로 이동했습니다."});
    expect(executeContactPipelineTransition).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({kind:"lead_to_contact",dealId:"deal-1",orgId:"org-1"}));
  });
  it("returns the recorded double-lock reason without pretending success", async () => {
    const reason="대표 직인 승인이 필요합니다. 현재 직인 완료 = 대기";
    executeContactPipelineTransition.mockResolvedValue({status:"blocked",dealId:"deal-1",companyId:null,reason});
    const form=new FormData(); form.set("kind","contact_to_work"); form.set("dealId","deal-1"); form.set("requestId","00000000-0000-4000-8000-000000000099"); form.set("companyName","새봄상사");
    await expect(mutateContactPipeline({ok:false,message:""},form)).resolves.toEqual({
      ok:false,message:reason,
      unmet:[{key:"seal_approval",label:"대표 직인 승인",satisfied:false,currentValueLabel:"대기"}],
    });
  });
  it("passes a contact-board item as source identity instead of cloning a customer snapshot", async () => {
    const form=new FormData(); form.set("kind","contact_to_work"); form.set("sourceItemId","00000000-0000-4000-8000-000000000020"); form.set("sourceBoardId","00000000-0000-4000-8000-000000000030"); form.set("requestId","00000000-0000-4000-8000-000000000099"); form.set("companyName","모아 상사");
    await mutateContactPipeline({ok:false,message:""},form);
    expect(getDeal).not.toHaveBeenCalled();
    expect(setCells).toHaveBeenCalledWith(expect.anything(), "00000000-0000-4000-8000-000000000030", "00000000-0000-4000-8000-000000000020", { work_move: "업무관리 이동" });
    expect(executeContactPipelineTransition).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({dealId:null,sourceItemId:"00000000-0000-4000-8000-000000000020"}));
  });
  it("does not pretend the tab transfer ran when its attached board status could not be saved", async () => {
    setCells.mockResolvedValue({ errors: [{ message: "상태 저장 실패" }] });
    const form=new FormData(); form.set("kind","contact_to_work"); form.set("sourceItemId","item-20"); form.set("sourceBoardId","board-30"); form.set("requestId","00000000-0000-4000-8000-000000000099"); form.set("companyName","모아 상사");
    await expect(mutateContactPipeline({ok:false,message:""},form)).resolves.toEqual({ ok:false, message:"상태 저장 실패" });
    expect(executeContactPipelineTransition).not.toHaveBeenCalled();
  });
  it("rejects a selected company outside the request scope", async () => {
    const form=new FormData(); form.set("kind","contact_to_work"); form.set("dealId","deal-1"); form.set("requestId","00000000-0000-4000-8000-000000000099"); form.set("selectedCompanyId","hidden");
    await expect(mutateContactPipeline({ok:false,message:""},form)).resolves.toEqual({ok:false,message:"접근 가능한 업체를 다시 선택해 주세요."});
    expect(executeContactPipelineTransition).not.toHaveBeenCalled();
  });
});
