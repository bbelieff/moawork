"use client";

import { startTransition,useRef,useState } from "react";
import type { ItemWithValues } from "@/lib/boards/types";
import { moveItemAction,moveRowAction,reorderGroupsAction } from "@/app/(app)/boards/actions";
import { GroupNameEditor } from "@/components/board/GroupNameEditor";
import { claimBoardTransientSurface } from "@/components/board/BoardAnchoredMenu";

export interface KanbanLane { key:string;label:string;color:string|null;items:ItemWithValues[]; }
type Dragged={itemId:string;laneKey:string};
type Target={laneKey:string;beforeItemId:string|null};

export function GenericBoardKanban({boardId,lanes,groupBy,readOnly=false,rowOrderVersion=0,canMoveRows=false,canManageSections=false,isSystem=false}:{boardId:string;lanes:KanbanLane[];groupBy:string;readOnly?:boolean;rowOrderVersion?:number;canMoveRows?:boolean;canManageSections?:boolean;isSystem?:boolean;}){
  const draggedRef=useRef<Dragged|null>(null);
  const pendingRef=useRef(false);
  const intentRef=useRef<{key:string;requestId:string;expectedVersion:number|null}|null>(null);
  const [draggedId,setDraggedId]=useState<string|null>(null);
  const [over,setOver]=useState<Target|null>(null);
  const [pending,setPending]=useState(false);
  const [knownVersion,setKnownVersion]=useState(rowOrderVersion);
  const [message,setMessage]=useState<string|null>(null);
  const [moveError,setMoveError]=useState(false);
  const physicalGroups=groupBy==="";
  const moveAllowed=!readOnly&&(!physicalGroups||canMoveRows);
  const effectiveVersion=Math.max(knownVersion,rowOrderVersion);
  const groupIds=lanes.map((lane)=>lane.key).filter(Boolean);
  const clearDrag=()=>{draggedRef.current=null;setDraggedId(null);setOver(null);};

  const submitMove=(itemId:string,currentLane:string,targetLane:string,beforeItemId:string|null)=>{
    if(pendingRef.current){setMoveError(true);setMessage("이전 이동을 저장하고 있어요.");return;}
    if(!moveAllowed){setMoveError(true);setMessage("이 보기에서는 행을 옮길 수 없어요.");return;}
    const payload={itemId,targetLane,beforeItemId,groupBy};
    const key=JSON.stringify(payload);
    if(intentRef.current?.key!==key)intentRef.current={key,requestId:crypto.randomUUID(),expectedVersion:physicalGroups?effectiveVersion:null};
    const {requestId,expectedVersion}=intentRef.current;
    const fd=new FormData();fd.set("boardId",boardId);fd.set("itemId",itemId);fd.set("eventKey",requestId);fd.set("requestId",requestId);
    if(physicalGroups){fd.set("groupId",targetLane);fd.set("beforeItemId",beforeItemId??"");fd.set("expectedVersion",String(expectedVersion));}
    else{if(currentLane===targetLane){setMoveError(false);setMessage("현재 레인과 같아 이동하지 않았습니다.");intentRef.current=null;return;}fd.set("groupBy",groupBy);fd.set("lane",targetLane);}
    pendingRef.current=true;setPending(true);clearDrag();
    startTransition(async()=>{
      try{
        const result=physicalGroups?await moveRowAction(fd):await moveItemAction(fd);
        if(result.ok){intentRef.current=null;setMoveError(false);if(result.version!==null)setKnownVersion((current)=>Math.max(current,result.version!));setMessage(result.replayed?"이미 저장된 이동을 확인했습니다.":"행 이동을 저장했습니다.");}
        else{if(result.stale)intentRef.current=null;setMoveError(true);setMessage(result.message);}
      }catch{setMoveError(true);setMessage("행 이동 결과를 확인하지 못했어요. 같은 이동을 다시 시도해 주세요.");}
      finally{pendingRef.current=false;setPending(false);}
    });
  };
  const dropAt=(target:Target)=>{const dragged=draggedRef.current;if(!dragged||target.beforeItemId===dragged.itemId){setOver(null);setMoveError(true);setMessage("같은 위치에는 놓을 수 없어요.");return;}submitMove(dragged.itemId,dragged.laneKey,target.laneKey,target.beforeItemId);};

  return <div className="flex gap-3 overflow-x-auto pb-2 text-mw-fg">
    <p className="sr-only" role={moveError?"alert":"status"} aria-live={moveError?"assertive":"polite"}>{message}</p>
    {lanes.map((lane)=>{const canEditGroup=physicalGroups&&!isSystem&&canManageSections&&Boolean(lane.key);return <section key={lane.key||"__none__"}
      onDragOver={(event)=>{const dragged=draggedRef.current;if(!dragged||!moveAllowed){setOver(null);setMessage("이 레인으로 이동할 권한이 없어요.");return;}if(event.target!==event.currentTarget&&!(event.target as HTMLElement).closest("ul"))return;event.preventDefault();event.dataTransfer.dropEffect="move";setOver({laneKey:lane.key,beforeItemId:null});setMessage(`${lane.label} 레인 맨 아래로 이동합니다.`);}}
      onDragLeave={(event)=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setOver(null);}}
      onDrop={(event)=>{event.preventDefault();dropAt({laneKey:lane.key,beforeItemId:null});}}
      className={`flex w-64 shrink-0 flex-col gap-2 rounded border border-mw-line bg-mw-bg p-2 ${over?.laneKey===lane.key&&over.beforeItemId===null?"border-mw-record bg-mw-tint-blue":""}`}>
      <header className="flex items-center gap-2 px-1"><span className="h-2 w-2 rounded-full" style={{backgroundColor:lane.color??"#c4c4c4"}} aria-hidden/><h3 className="min-w-0 text-sm font-medium">{canEditGroup?<GroupNameEditor boardId={boardId} groupId={lane.key} name={lane.label}/>:lane.label}</h3><span className="ml-auto text-xs text-mw-sub">{lane.items.length}</span>
        {canEditGroup?<span className="sr-only focus-within:not-sr-only" aria-label={`${lane.label} 그룹 순서`}>{([-1,1] as const).map((delta)=>{const from=groupIds.indexOf(lane.key);const to=Math.max(0,Math.min(groupIds.length-1,from+delta));const next=[...groupIds];if(from>=0&&from!==to){const [moved]=next.splice(from,1);next.splice(to,0,moved);}return <form key={delta} action={reorderGroupsAction} className="inline"><input type="hidden" name="boardId" value={boardId}/><input type="hidden" name="groupIds" value={JSON.stringify(next)}/><button type="submit" disabled={from<0||from===to} aria-label={`${lane.label} ${delta<0?"위":"아래"}로 이동`}>{delta<0?"↑":"↓"}</button></form>;})}</span>:null}
      </header>
      <ul className="flex flex-col gap-2" onDragOver={(event)=>event.preventDefault()}>
        {lane.items.map((item,index)=><li key={item.id} draggable={moveAllowed}
          onDragStart={moveAllowed?(event)=>{if((event.target as HTMLElement).closest("button,input,select,textarea,a,[contenteditable=true],[data-no-drag]")){event.preventDefault();setMessage("편집 중인 컨트롤에서는 끌 수 없어요.");return;}claimBoardTransientSurface(`board:${boardId}`,`kanban-row-drag:${boardId}`);event.dataTransfer.effectAllowed="move";draggedRef.current={itemId:item.id,laneKey:lane.key};setDraggedId(item.id);setMessage("이동할 위치를 선택하세요.");}:undefined}
          onDragOver={(event)=>{const dragged=draggedRef.current;if(!dragged||!moveAllowed||dragged.itemId===item.id){setOver(null);return;}event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect="move";setOver({laneKey:lane.key,beforeItemId:item.id});setMessage(`${item.title} 앞에 놓습니다.`);}}
          onDrop={(event)=>{event.preventDefault();event.stopPropagation();dropAt({laneKey:lane.key,beforeItemId:item.id});}}
          onDragEnd={()=>{clearDrag();setMessage(null);}}
          className={`rounded border bg-mw-card p-2 text-sm ${moveAllowed?"cursor-grab active:cursor-grabbing":""} ${draggedId===item.id?"opacity-50":""} ${over?.beforeItemId===item.id?"border-t-4 border-t-mw-record":"border-mw-line"}`}>
          <p className="font-medium">{item.title}</p>{item.assigned_to?<p className="mt-1 text-xs text-mw-sub">담당 {item.assigned_to.slice(0,8)}</p>:null}
          {moveAllowed?<span className="sr-only focus-within:not-sr-only" data-no-drag>
            {physicalGroups?<><button type="button" disabled={pending||index===0} onClick={()=>submitMove(item.id,lane.key,lane.key,lane.items[index-1]?.id??null)} aria-label={`${item.title} 위로 이동`}>위로 이동</button><button type="button" disabled={pending||index===lane.items.length-1} onClick={()=>submitMove(item.id,lane.key,lane.key,lane.items[index+2]?.id??null)} aria-label={`${item.title} 아래로 이동`}>아래로 이동</button></>:null}
            {lanes.length>1?<form onSubmit={(event)=>{event.preventDefault();const data=new FormData(event.currentTarget);submitMove(item.id,lane.key,String(data.get("lane")??""),null);}} className="inline"><select name="lane" defaultValue={lane.key} disabled={pending} aria-label={`${item.title} 이동할 레인`}>{lanes.map((target)=><option key={target.key||"__none__"} value={target.key}>{target.label}</option>)}</select><button type="submit" disabled={pending}>이동</button></form>:null}
          </span>:null}
        </li>)}
        {lane.items.length===0?<li className="rounded border border-dashed border-mw-line p-3 text-center text-xs text-mw-sub">비어 있음</li>:null}
      </ul>
    </section>;})}
  </div>;
}
