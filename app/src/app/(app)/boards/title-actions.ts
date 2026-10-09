"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { loadPermGuard } from "@/lib/perm/guard";
import { createRequestBoards } from "@/lib/boards/server";
import { isTabIconKey } from "@/lib/boards/board-icons";
import { runColumnCommandAction } from "./column-command-actions";
import { INITIAL_COLUMN_COMMAND_STATE } from "./column-command-state";

export type InlineTitleResult = { ok: true; name: string } | { ok: false; message: string };

/** 탭 설명 길이 상한 — 설정 대화상자의 입력칸과 같은 값이다. */
const BOARD_DESCRIPTION_MAX = 200;

export type BoardIdentityPatch = { icon?: string; description?: string };
export type BoardIdentityResult =
  | { ok: true; icon?: string; description?: string | null }
  | { ok: false; message: string };

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

/**
 * #845 탭 설정 › 일반 — 탭 아이콘·설명을 바꾼다. 이름 바꾸기와 같은 권한(structure.tab_manage)·같은 저장 경로다.
 * 아이콘은 선 아이콘 한 벌의 키만 받는다(이모지·임의 글자는 저장하지 않는다). 설명은 앞뒤 공백을 걷고
 * 200자까지, 비우면 지운다(null). 권한·값이 맞지 않으면 아무것도 쓰지 않는다.
 */
export async function updateBoardIdentityAction(boardId:string,patch:BoardIdentityPatch):Promise<BoardIdentityResult>{
  try{
    const ctx=await getSession();
    if(!await allowed(ctx.org.id,"structure.tab_manage"))return{ok:false,message:"탭을 고칠 권한이 없어요."};
    const update:{icon?:string;description?:string|null}={};
    if(patch.icon!==undefined){
      if(!isTabIconKey(patch.icon))return{ok:false,message:"고를 수 없는 아이콘이에요."};
      update.icon=patch.icon;
    }
    if(patch.description!==undefined){
      if(typeof patch.description!=="string")return{ok:false,message:"설명을 읽지 못했어요."};
      const description=patch.description.trim();
      if(description.length>BOARD_DESCRIPTION_MAX)return{ok:false,message:`설명은 ${BOARD_DESCRIPTION_MAX}자까지 쓸 수 있어요.`};
      update.description=description||null;
    }
    if(update.icon===undefined&&update.description===undefined)return{ok:false,message:"바꿀 내용이 없어요."};
    await (await createRequestBoards()).service.updateBoard(ctx,boardId,update);
    // 이름 바꾸기와 같다 — 이 보드 화면(머리말·사이드바 포함)을 다시 그린다.
    revalidatePath(`/boards/${boardId}`);
    return{ok:true,...update};
  }catch(error){
    console.error("[board identity]",error);
    return{ok:false,message:"저장하지 못했어요. 권한과 연결 상태를 확인한 뒤 다시 시도해 주세요."};
  }
}
