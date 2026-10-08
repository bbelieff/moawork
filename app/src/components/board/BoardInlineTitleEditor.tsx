"use client";

import { useImperativeHandle,useRef,useState,type ReactNode,type Ref } from "react";
import type { InlineTitleResult } from "@/app/(app)/boards/title-actions";
import { noticeLive, noticeRole } from "@/lib/ui/result-notice";

/** 메뉴의 「이름 바꾸기」 처럼 바깥에서 편집을 시작할 때 쓴다(#845 탭 제목 ▾ 메뉴). */
export type BoardInlineTitleEditorHandle={beginEdit():void};

export function BoardInlineTitleEditor({name,label,onSave,className="",display,idle,onEditEnd,ref}:{
  name:string;
  label:string;
  onSave:(name:string)=>Promise<InlineTitleResult>;
  className?:string;
  /** 편집 중이 아닐 때 보일 글자(표시 전용). 편집칸은 언제나 저장된 원문으로 시작한다. */
  display?:(saved:string)=>string;
  /**
   * #845 칸 머리글 — 편집 중이 아닐 때 기본 「편집」 단추 대신 그릴 것(예: 칸 메뉴를 여는 제목).
   * 이때 편집은 메뉴의 「칸 이름 바꾸기」 → ref.beginEdit() 로만 시작하고, 쉴 때는 끌기를 막지 않는다
   * (머리글을 끌어 칸 순서를 바꾸는 동작을 그대로 둔다).
   */
  idle?:(shown:string)=>ReactNode;
  /** 편집칸이 닫힐 때(저장·취소·실패 모두). 바깥이 초점을 돌려줄 때 쓴다. */
  onEditEnd?:()=>void;
  ref?:Ref<BoardInlineTitleEditorHandle>;
}){
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState(name);
  const [saved,setSaved]=useState(name);
  const [observedName,setObservedName]=useState(name);
  const [pending,setPending]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const pendingRef=useRef(false);
  const cancelledRef=useRef(false);

  if(name!==observedName&&!editing&&!pending){
    setObservedName(name);
    setSaved(name);
    setDraft(name);
  }

  const shown=saved;
  const endEdit=()=>{setEditing(false);onEditEnd?.();};
  const begin=()=>{if(pendingRef.current)return;cancelledRef.current=false;setDraft(shown);setError(null);setEditing(true);};
  useImperativeHandle(ref,()=>({beginEdit:begin}));
  const commit=async()=>{
    if(pendingRef.current||cancelledRef.current)return;
    const next=draft.trim();
    if(!next){setError("이름을 입력해 주세요.");return;}
    if(next===shown){endEdit();setError(null);return;}
    pendingRef.current=true;setPending(true);setError(null);
    try{
      const result=await onSave(next);
      if(result.ok){setSaved(result.name);setDraft(result.name);endEdit();setError(null);}
      else{setDraft(saved);endEdit();setError(result.message);}
    }catch{
      setDraft(saved);endEdit();setError("이름을 저장하지 못했어요. 다시 시도해 주세요.");
    }finally{
      pendingRef.current=false;setPending(false);
    }
  };
  const stop=(event:React.SyntheticEvent)=>event.stopPropagation();
  const errorNote=error?<span role={noticeRole(false)} aria-live={noticeLive(false)} className="ml-1 text-[0.65rem] font-normal text-mw-error">{error}</span>:null;

  if(idle&&!editing)return <span className={`flex min-w-0 items-center ${className}`}>{idle(display?display(shown):shown)}{errorNote}</span>;

  return <span className={`min-w-0 ${className}`} onPointerDown={stop} onDragStart={(event)=>event.preventDefault()}>
    {editing?<input
      autoFocus
      value={draft}
      aria-label={label}
      disabled={pending}
      maxLength={100}
      onFocus={(event)=>event.currentTarget.select()}
      onChange={(event)=>{setDraft(event.target.value);setError(null);}}
      onClick={stop}
      onBlur={()=>{void commit();}}
      onKeyDown={(event)=>{
        if(event.key==="Enter"){event.preventDefault();void commit();}
        if(event.key==="Escape"){event.preventDefault();cancelledRef.current=true;setDraft(shown);setError(null);endEdit();}
      }}
      className="h-8 min-w-24 max-w-full rounded border border-mw-record bg-mw-card px-2 text-inherit text-mw-fg outline-none focus:ring-2 focus:ring-mw-primary"
    />:<button type="button" onClick={(event)=>{stop(event);begin();}} className="max-w-full truncate rounded px-1 text-left font-inherit text-inherit focus:outline-none focus:ring-2 focus:ring-mw-primary" aria-label={`${label} 편집`}>
      {pending?"저장 중…":display?display(shown):shown}
    </button>}
    {errorNote}
  </span>;
}
