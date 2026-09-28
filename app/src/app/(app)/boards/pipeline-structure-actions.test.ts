import { beforeEach, describe, expect, it, vi } from "vitest";
const { session, client, rpc } = vi.hoisted(() => ({ session:vi.fn(),client:vi.fn(),rpc:vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession:session }));
vi.mock("@/lib/supabase/server", () => ({ createClient:client }));
import { pipelineStructureAction } from "./pipeline-structure-actions";
beforeEach(() => { vi.resetAllMocks(); session.mockResolvedValue({org:{id:"current-org"}});client.mockResolvedValue({rpc}); });
describe("pipeline repair request-bound action", () => {
  it("uses current server org and exact preview identity with request SSR client", async () => {
    rpc.mockResolvedValue({data:[{pipeline_id:"p",pipeline_name:"기본",missing_kinds:[]}],error:null});
    expect(await pipelineStructureAction({itemId:"i",apply:true,pipelineId:"p",missing:["work"]})).toMatchObject({ok:true,missing:[]});
    expect(rpc).toHaveBeenCalledWith("repair_new_lead_pipeline_structure",{p_org_id:"current-org",p_item_id:"i",p_apply:true,p_expected_pipeline_id:"p",p_expected_missing:["work"]});
  });
  it.each(["42501","40001","22023"])("returns truthful error for %s", async (code) => {
    rpc.mockResolvedValue({error:{code}});
    expect(await pipelineStructureAction({itemId:"i"})).toMatchObject({ok:false});
  });
  it("transport or malformed results never claim no write or success", async () => {
    rpc.mockRejectedValueOnce(new Error("network"));
    expect(await pipelineStructureAction({itemId:"i",apply:true})).toMatchObject({ok:false,message:expect.stringContaining("결과를 확인하지 못했습니다")});
    rpc.mockResolvedValueOnce({data:[],error:null});
    expect(await pipelineStructureAction({itemId:"i"})).toMatchObject({ok:false});
  });
});
