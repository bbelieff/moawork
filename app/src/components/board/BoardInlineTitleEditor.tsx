"use client";

import { useRef,useState } from "react";
import type { InlineTitleResult } from "@/app/(app)/boards/title-actions";
import { noticeLive, noticeRole } from "@/lib/ui/result-notice";

export function BoardInlineTitleEditor({name,label,onSave,className=""}:{
  name:string;
  label:string;
  onSave:(name:string)=>Promise<InlineTitleResult>;
  className?:string;
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
  const begin=()=>{if(pendingRef.current)return;cancelledRef.current=false;setDraft(shown);setError(null);setEditing(true);};
  const commit=async()=>{
    if(pendingRef.current||cancelledRef.current)return;
    const next=draft.trim();
    if(!next){setError("이름을 입력해 주세요.");return;}
    if(next===shown){setEditing(false);setError(null);return;}
    pendingRef.current=true;setPending(true);setError(null);
    try{
      const result=await onSave(next);
      if(result.ok){setSaved(result.name);setDraft(result.name);setEditing(false);setError(null);}
      else{setDraft(saved);setEditing(false);setError(result.message);}
    }catch{
      setDraft(saved);setEditing(false);setError("이름을 저장하지 못했어요. 다시 시도해 주세요.");
    }finally{
      pendingRef.current=false;setPending(false);
    }
  };
  const stop=(event:React.SyntheticEvent)=>event.stopPropagation();

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
        if(event.key==="Escape"){event.preventDefault();cancelledRef.current=true;setDraft(shown);setError(null);setEditing(false);}
      }}
      className="h-8 min-w-24 max-w-full rounded border border-mw-record bg-mw-card px-2 text-inherit text-mw-fg outline-none focus:ring-2 focus:ring-mw-primary"
    />:<button type="button" onClick={(event)=>{stop(event);begin();}} className="max-w-full truncate rounded px-1 text-left font-inherit text-inherit focus:outline-none focus:ring-2 focus:ring-mw-primary" aria-label={`${label} 편집`}>
      {pending?"저장 중…":shown}
    </button>}
    {error?<span role={noticeRole(false)} aria-live={noticeLive(false)} className="ml-1 text-[0.65rem] font-normal text-mw-error">{error}</span>:null}
  </span>;
}
