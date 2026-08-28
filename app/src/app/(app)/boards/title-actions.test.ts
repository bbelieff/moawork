import { beforeEach,describe,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({guard:vi.fn(async()=>({kind:"allowed"})),updateBoard:vi.fn(async()=>({})),renameGroup:vi.fn(async()=>({})),column:vi.fn(async(previous:unknown,data:FormData)=>{void previous;void data;return{ok:true,message:"ok"};}),revalidate:vi.fn()}));
vi.mock("next/cache",()=>({revalidatePath:mocks.revalidate}));
vi.mock("@/lib/auth/session",()=>({getSession:async()=>({org:{id:"org-a"},user:{id:"user-a"},role:"owner",scope:"all"})}));
vi.mock("@/lib/perm/guard",()=>({loadPermGuard:mocks.guard}));
vi.mock("@/lib/boards/server",()=>({createRequestBoards:async()=>({service:{updateBoard:mocks.updateBoard,renameGroup:mocks.renameGroup}})}));
vi.mock("./column-command-actions",()=>({runColumnCommandAction:mocks.column}));
import { renameBoardTitleAction,renameColumnTitleAction,renameGroupTitleAction } from "./title-actions";

describe("direct board title actions",()=>{
  beforeEach(()=>Object.values(mocks).forEach((mock)=>mock.mockClear()));
  it("trims and routes board/group names through exact permissions",async()=>{
    await expect(renameBoardTitleAction("board-a","  새 보드  ")).resolves.toEqual({ok:true,name:"새 보드"});
    expect(mocks.guard).toHaveBeenCalledWith("org-a","structure.tab_manage");expect(mocks.updateBoard).toHaveBeenCalledWith(expect.anything(),"board-a",{name:"새 보드"});
    await expect(renameGroupTitleAction("board-a","group-a"," 새 그룹 ")).resolves.toEqual({ok:true,name:"새 그룹"});
    expect(mocks.guard).toHaveBeenLastCalledWith("org-a","structure.section_manage");expect(mocks.renameGroup).toHaveBeenCalledWith(expect.anything(),"board-a","group-a","새 그룹");
  });
  it("fails closed and sends no write when permission is unavailable",async()=>{
    mocks.guard.mockResolvedValueOnce({kind:"denied"} as never);
    expect(await renameBoardTitleAction("board-a","변경")).toMatchObject({ok:false});expect(mocks.updateBoard).not.toHaveBeenCalled();
  });
  it("routes physical column rename through the canonical audited command",async()=>{
    expect(await renameColumnTitleAction("board-a","column-a"," 새 컬럼 ")).toEqual({ok:true,name:"새 컬럼"});
    const data=mocks.column.mock.calls[0][1];
    expect(Object.fromEntries(data)).toMatchObject({boardId:"board-a",columnId:"column-a",operation:"rename",label:"새 컬럼"});
    expect(String(data.get("requestId"))).toMatch(/^[0-9a-f-]{36}$/u);
  });
  it("logs infrastructure failures without returning raw database details",async()=>{
    const log=vi.spyOn(console,"error").mockImplementation(()=>undefined);mocks.updateBoard.mockRejectedValueOnce(new Error("relation public.secret does not exist"));
    const result=await renameBoardTitleAction("board-a","변경");expect(result).toMatchObject({ok:false});if(result.ok)throw new Error("expected failure");expect(result.message).not.toContain("public.secret");expect(log).toHaveBeenCalled();log.mockRestore();
  });
});
