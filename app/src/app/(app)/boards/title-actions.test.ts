import { beforeEach,describe,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({guard:vi.fn(async()=>({kind:"allowed"})),updateBoard:vi.fn(async()=>({})),renameGroup:vi.fn(async()=>({})),column:vi.fn(async(previous:unknown,data:FormData)=>{void previous;void data;return{ok:true,message:"ok"};}),revalidate:vi.fn()}));
vi.mock("next/cache",()=>({revalidatePath:mocks.revalidate}));
vi.mock("@/lib/auth/session",()=>({getSession:async()=>({org:{id:"org-a"},user:{id:"user-a"},role:"owner",scope:"all"})}));
vi.mock("@/lib/perm/guard",()=>({loadPermGuard:mocks.guard}));
vi.mock("@/lib/boards/server",()=>({createRequestBoards:async()=>({service:{updateBoard:mocks.updateBoard,renameGroup:mocks.renameGroup}})}));
vi.mock("./column-command-actions",()=>({runColumnCommandAction:mocks.column}));
import { renameBoardTitleAction,renameColumnTitleAction,renameGroupTitleAction,updateBoardIdentityAction } from "./title-actions";

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

describe("tab identity action (#845 탭 설정 › 일반)",()=>{
  beforeEach(()=>Object.values(mocks).forEach((mock)=>mock.mockClear()));
  it("saves a known monoline icon key under the tab-manage permission",async()=>{
    await expect(updateBoardIdentityAction("board-a",{icon:"star"})).resolves.toEqual({ok:true,icon:"star"});
    expect(mocks.guard).toHaveBeenCalledWith("org-a","structure.tab_manage");
    expect(mocks.updateBoard).toHaveBeenCalledWith(expect.anything(),"board-a",{icon:"star"});
    expect(mocks.revalidate).toHaveBeenCalledWith("/boards/board-a");
  });
  it("trims the description, clears it when empty and keeps the icon untouched",async()=>{
    await expect(updateBoardIdentityAction("board-a",{description:"  계약 이후 진행을 봐요  "})).resolves.toEqual({ok:true,description:"계약 이후 진행을 봐요"});
    expect(mocks.updateBoard).toHaveBeenLastCalledWith(expect.anything(),"board-a",{description:"계약 이후 진행을 봐요"});
    await expect(updateBoardIdentityAction("board-a",{description:"   "})).resolves.toEqual({ok:true,description:null});
    expect(mocks.updateBoard).toHaveBeenLastCalledWith(expect.anything(),"board-a",{description:null});
  });
  it("writes nothing when the permission is denied or unavailable",async()=>{
    mocks.guard.mockResolvedValueOnce({kind:"denied",reason:"permission"} as never);
    expect(await updateBoardIdentityAction("board-a",{icon:"star"})).toMatchObject({ok:false});
    mocks.guard.mockResolvedValueOnce({kind:"denied",reason:"unavailable"} as never);
    expect(await updateBoardIdentityAction("board-a",{description:"설명"})).toMatchObject({ok:false});
    expect(mocks.updateBoard).not.toHaveBeenCalled();
  });
  it("rejects an icon outside the set (emoji, unknown key) and a description over 200 characters without writing",async()=>{
    expect(await updateBoardIdentityAction("board-a",{icon:"💡"})).toEqual({ok:false,message:"고를 수 없는 아이콘이에요."});
    expect(await updateBoardIdentityAction("board-a",{icon:"rocket"})).toMatchObject({ok:false});
    expect(await updateBoardIdentityAction("board-a",{icon:"star",description:"가".repeat(201)})).toEqual({ok:false,message:"설명은 200자까지 쓸 수 있어요."});
    expect(await updateBoardIdentityAction("board-a",{})).toMatchObject({ok:false});
    expect(mocks.updateBoard).not.toHaveBeenCalled();
    await expect(updateBoardIdentityAction("board-a",{description:"가".repeat(200)})).resolves.toMatchObject({ok:true});
  });
  it("hides infrastructure details behind a plain message",async()=>{
    const log=vi.spyOn(console,"error").mockImplementation(()=>undefined);mocks.updateBoard.mockRejectedValueOnce(new Error("relation public.secret does not exist"));
    const result=await updateBoardIdentityAction("board-a",{icon:"flag"});
    expect(result).toMatchObject({ok:false});if(result.ok)throw new Error("expected failure");expect(result.message).not.toContain("public.secret");expect(log).toHaveBeenCalled();log.mockRestore();
  });
});
