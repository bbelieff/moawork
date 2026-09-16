import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), create: vi.fn(), client: vi.fn() }));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("next/headers",()=>({cookies:vi.fn(async()=>({set:vi.fn()}))}));
vi.mock("@/lib/auth/session",()=>({getSession:vi.fn(),getSessionOrNull:mocks.session}));
vi.mock("@/lib/perm/guard",()=>({loadPermGuard:mocks.permission}));
vi.mock("@/lib/supabase/server",()=>({createClient:mocks.client}));
vi.mock("@/lib/boards/server",()=>({createRequestBoards:vi.fn()}));
vi.mock("@/lib/new-lead/mutations",()=>({canonicalAssignee:vi.fn(),createCanonicalNewLead:mocks.create,NewLeadMutationError:class extends Error {},updateCanonicalNewLead:vi.fn(),updateCanonicalNewLeadMeta:vi.fn(),updateCanonicalNewLeadTitle:vi.fn()}));
vi.mock("@/lib/new-lead/advance",()=>({advanceNewLeadToContact:vi.fn(),NewLeadAdvanceError:class extends Error {}}));
import { createNewLeadAction } from "./new-lead-actions";
const initial={ok:false,message:""};
function form(){const data=new FormData(); for(const [key,value] of Object.entries({boardId:"board-a",groupId:"group-a",title:"테스트 입력",business_registration_type:"법인사업자",region_sido:"서울",region_sigungu:"없는 지역"}))data.set(key,value);return data;}
beforeEach(()=>{vi.clearAllMocks();mocks.session.mockResolvedValue({org:{id:"org-a"},user:{id:"user-a"}});});
it("세션이 없으면 리다이렉트/저장 대신 복구 안내를 반환한다",async()=>{
  mocks.session.mockResolvedValue(null);
  const result=await createNewLeadAction(initial,form());
  expect(result).toMatchObject({ok:false,field:"form"}); expect(result.message).toContain("다른 탭");
  expect(mocks.permission).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();
});
it("잘못된 시군구는 시도가 아니라 시군구를 지목하고 저장하지 않는다",async()=>{
  const result=await createNewLeadAction(initial,form());
  expect(result).toMatchObject({ok:false,field:"region_sigungu"}); expect(result.message).toContain("추천 목록");
  expect(mocks.create).not.toHaveBeenCalled();
});
it("접근 거절 시 등록하지 않고 오류를 반환한다",async()=>{
  mocks.permission.mockResolvedValue({kind:"denied",reason:"permission"});
  const data=form();data.set("region_sigungu","강남구");
  const result=await createNewLeadAction(initial,data);
  expect(result.ok).toBe(false);expect(result.message).toContain("권한");expect(mocks.create).not.toHaveBeenCalled();
});
