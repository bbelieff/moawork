"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { loadPermGuard } from "@/lib/perm/guard";
import { createRequestBoards } from "@/lib/boards/server";
import { runColumnCommandAction } from "./column-command-actions";
import { INITIAL_COLUMN_COMMAND_STATE } from "./column-command-state";

export type InlineTitleResult = { ok: true; name: string } | { ok: false; message: string };

function cleanName(value: string): string {
  const name=value.trim();
  if(!name)throw new Error("이름을 입력해 주세요.");
  if(name.length>100)throw new Error("이름은 100자까지 입력할 수 있어요.");
  return name;
}

async function allowed(orgId:string,scope:string):Promise<boolean>{
  return (await loadPermGuard(orgId,scope)).kind==="allowed";
}

function message(error:unknown):string{
  console.error("[board inline title]",error);
  const raw=error instanceof Error?error.message:"";
  if(raw==="이름을 입력해 주세요."||raw==="이름은 100자까지 입력할 수 있어요.")return raw;
  return "이름을 저장하지 못했어요. 권한과 연결 상태를 확인한 뒤 다시 시도해 주세요.";
}

export async function renameBoardTitleAction(boardId:string,value:string):Promise<InlineTitleResult>{
  try{
    const ctx=await getSession();
    if(!await allowed(ctx.org.id,"structure.tab_manage"))return{ok:false,message:"보드 이름을 바꿀 권한이 없어요."};
    const name=cleanName(value);
    await (await createRequestBoards()).service.updateBoard(ctx,boardId,{name});
    revalidatePath(`/boards/${boardId}`);
    return{ok:true,name};
  }catch(error){return{ok:false,message:message(error)};}
}

export async function renameGroupTitleAction(boardId:string,groupId:string,value:string):Promise<InlineTitleResult>{
  try{
    const ctx=await getSession();
    if(!await allowed(ctx.org.id,"structure.section_manage"))return{ok:false,message:"그룹 이름을 바꿀 권한이 없어요."};
    const name=cleanName(value);
    await (await createRequestBoards()).service.renameGroup(ctx,boardId,groupId,name);
    revalidatePath(`/boards/${boardId}`);
    return{ok:true,name};
  }catch(error){return{ok:false,message:message(error)};}
}

export async function renameColumnTitleAction(boardId:string,columnId:string,value:string):Promise<InlineTitleResult>{
  const name=value.trim();
  if(!name)return{ok:false,message:"이름을 입력해 주세요."};
  const data=new FormData();
  data.set("boardId",boardId);data.set("columnId",columnId);data.set("operation","rename");
  data.set("requestId",crypto.randomUUID());data.set("label",name);
  const result=await runColumnCommandAction(INITIAL_COLUMN_COMMAND_STATE,data);
  return result.ok?{ok:true,name}:{ok:false,message:result.message??"컬럼 이름을 저장하지 못했어요."};
}
