"use client";

import { useActionState, useMemo, useState } from "react";
import { mutateWork, type WorkActionState } from "@/app/(app)/work/actions";
import { calendarBuckets, visibleItems } from "@/lib/work-management/domain";
import { canManageStructure, canMutateField, type WorkBoardSnapshot, type WorkColumnContract, type WorkItemSnapshot, type WorkViewKind } from "@/lib/work-management/contracts";
import styles from "./work-management.module.css";

const actionInitial: WorkActionState = { ok: false, message: "" };

function ActionForm({ snapshot, item, operation, field, children }: { snapshot: WorkBoardSnapshot; item?: WorkItemSnapshot; operation: string; field?: string; children: React.ReactNode }) {
  const [state, action, pending] = useActionState(mutateWork, actionInitial);
  return <form action={action} className={styles.actionForm} aria-busy={pending}>
    <input type="hidden" name="operation" value={operation}/><input type="hidden" name="boardId" value={snapshot.board.id}/>
    <input type="hidden" name="itemId" value={item?.id ?? ""}/><input type="hidden" name="expectedVersion" value={item?.version ?? 0}/>
    {field ? <input type="hidden" name="field" value={field}/> : null}{children}
    {/* 셀 저장 실패가 조용히 지나가지 않도록 role 도 state.ok 로 분기한다(BBE-193). */}
    {state.message ? <small role={state.ok ? "status" : "alert"} className={state.ok ? styles.success : styles.error}>{state.message}</small> : null}
  </form>;
}

function Cell({ snapshot, item, column }: { snapshot: WorkBoardSnapshot; item: WorkItemSnapshot; column: WorkColumnContract }) {
  const value = column.key === "title" ? item.title : column.key === "assigned_to" ? item.assignedTo : column.key === "workflow_status" ? item.workflowStatus : column.key === "due_date" ? item.dueDate : column.key === "company" ? item.companyDisplay : column.key === "representative" || column.key === "email" || column.key === "phone" ? item.contactDisplay : item.values[column.key];
  const allowed = !column.readOnly && canMutateField(snapshot.role, column.key) && column.kind !== "file";
  if (!allowed) return <span className={styles.cellText} title={column.kind === "file" && !snapshot.filesEnabled ? "Storage/RLS 검증 후 사용할 수 있습니다." : undefined}>{column.kind === "file" && !snapshot.filesEnabled ? "파일 비활성" : String(value ?? "—")}</span>;
  if (column.key === "assigned_to") return <ActionForm snapshot={snapshot} item={item} operation="set_field" field="assigned_to"><select className={styles.cellInput} name="value" defaultValue={String(value ?? "")} aria-label="담당자 수정"><option value="">재배정 필요</option>{snapshot.members.map((member) => <option key={member.membershipId} value={member.userId}>{member.displayName}</option>)}</select><button className={styles.saveButton}>저장</button></ActionForm>;
  if (column.key === "workflow_status") return <ActionForm snapshot={snapshot} item={item} operation="set_field" field="workflow_status"><select className={styles.cellInput} name="value" defaultValue={String(value ?? "not_started")} aria-label="진행상황 수정"><option value="not_started">시작 전</option><option value="in_progress">작업 중</option><option value="done">완료</option><option value="blocked">차단</option></select><button className={styles.saveButton}>저장</button></ActionForm>;
  const inputType = column.kind === "date" || column.kind === "system_date" ? "date" : column.kind === "amount" || column.kind === "percent" || column.kind === "year" ? "number" : column.kind === "url" ? "url" : "text";
  return <ActionForm snapshot={snapshot} item={item} operation="set_field" field={column.key}><input className={styles.cellInput} name="value" type={inputType} defaultValue={String(value ?? "")} aria-label={`${column.label} 수정`}/><button className={styles.saveButton}>저장</button></ActionForm>;
}

function TableView({ snapshot, items, onOpen }: { snapshot: WorkBoardSnapshot; items: WorkItemSnapshot[]; onOpen: (item: WorkItemSnapshot) => void }) {
  return <div className={styles.tableWrap}><table><thead><tr>{snapshot.columns.map((column, index) => <th key={column.key} className={column.key === "title" ? styles.sticky : undefined}>{column.label}{canManageStructure(snapshot.role) && !column.system ? <details><summary aria-label={`${column.label} 열 메뉴`}>...</summary><ActionForm snapshot={snapshot} operation="rename_column"><input type="hidden" name="columnKey" value={column.key}/><input name="value" defaultValue={column.label}/><button>이름 변경</button></ActionForm><ActionForm snapshot={snapshot} operation="reorder_column"><input type="hidden" name="columnKey" value={column.key}/><input type="number" min="0" name="position" defaultValue={index}/><button>이동</button></ActionForm><ActionForm snapshot={snapshot} operation="delete_column"><input type="hidden" name="columnKey" value={column.key}/><button>삭제</button></ActionForm></details> : null}</th>)}</tr></thead><tbody>{snapshot.groups.flatMap((group, groupIndex) => {
    const rows = items.filter((item) => item.groupId === group.id);
    return [<tr key={`g-${group.id}`} className={styles.groupRow}><th colSpan={snapshot.columns.length}><span style={{ background: group.color }}/>{group.name} <small>{rows.length}</small>{canManageStructure(snapshot.role) ? <details><summary aria-label={`${group.name} 그룹 메뉴`}>...</summary><ActionForm snapshot={snapshot} operation="rename_group"><input type="hidden" name="groupId" value={group.id}/><input name="value" defaultValue={group.name}/><button>이름 변경</button></ActionForm><ActionForm snapshot={snapshot} operation="reorder_group"><input type="hidden" name="groupId" value={group.id}/><input type="number" min="0" name="position" defaultValue={groupIndex}/><button>이동</button></ActionForm><ActionForm snapshot={snapshot} operation="delete_group"><input type="hidden" name="groupId" value={group.id}/><button>삭제</button></ActionForm></details> : null}</th></tr>, ...rows.map((item) => <tr key={item.id}>{snapshot.columns.map((column) => <td key={column.key} className={column.key === "title" ? styles.sticky : undefined}>{column.key === "title" ? <button className={styles.detailTrigger} onClick={() => onOpen(item)} aria-label={`${item.title} 상세 열기`}>{item.title}</button> : <Cell snapshot={snapshot} item={item} column={column}/>}</td>)}</tr>)];
  })}</tbody></table></div>;
}

function CalendarView({ snapshot, onOpen }: { snapshot: WorkBoardSnapshot; onOpen: (item: WorkItemSnapshot) => void }) {
  return <div className={styles.calendar}>{calendarBuckets(snapshot).map(([date, items]) => <section key={date}><h3>{date === "unscheduled" ? "날짜 없음" : date}</h3>{items.map((item) => <article key={item.id}><button onClick={() => onOpen(item)}>{item.title}<small>{item.companyDisplay ?? "연결 업체 없음"}</small></button>{canMutateField(snapshot.role, "due_date") ? <ActionForm snapshot={snapshot} item={item} operation="set_due_date" field="due_date"><input name="value" type="date" defaultValue={item.dueDate ?? ""} aria-label={`${item.title} 마감일 이동`}/><button className={styles.saveButton}>이동</button></ActionForm> : null}</article>)}</section>)}</div>;
}

function GanttView({ snapshot, onOpen }: { snapshot: WorkBoardSnapshot; onOpen: (item: WorkItemSnapshot) => void }) {
  return <div className={styles.gantt}>{snapshot.items.map((item) => <button key={item.id} onClick={() => onOpen(item)}><span>{item.title}</span><i className={item.dueDate ? styles.milestone : styles.unscheduled}/><time>{item.dueDate ?? "날짜 없음"}</time></button>)}</div>;
}

function Detail({ snapshot, item, onClose }: { snapshot: WorkBoardSnapshot; item: WorkItemSnapshot; onClose: () => void }) {
  const [tab, setTab] = useState<"updates" | "files" | "activity">("updates");
  return <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={`${item.title} 상세`} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}><header><div><small>업무 상세</small><h2>{item.title}</h2></div><button autoFocus onClick={onClose} aria-label="상세 닫기">×</button></header><nav>{(["updates", "files", "activity"] as const).map((key) => <button key={key} aria-current={tab === key ? "page" : undefined} onClick={() => setTab(key)}>{key === "updates" ? "업데이트" : key === "files" ? "파일" : "활동 로그"}</button>)}</nav>
    {tab === "updates" ? <div className={styles.detailBody}><ActionForm snapshot={snapshot} item={item} operation="append_update" field="update_entry"><textarea name="value" maxLength={10000} placeholder="업데이트를 입력하세요" aria-label="업데이트 내용"/><button disabled={!canMutateField(snapshot.role, "update_entry")}>업데이트 추가</button></ActionForm>{item.updates.map((entry) => <article key={entry.id}><p>{entry.body}</p><time>{entry.createdAt}</time></article>)}</div> : null}
    {tab === "files" ? <div className={styles.detailBody}><p>{snapshot.filesEnabled ? "검증된 파일 저장소가 연결되었습니다." : "파일은 Storage/RLS 실검증 후 활성화됩니다."}</p><button disabled={!snapshot.filesEnabled}>파일 추가</button></div> : null}
    {tab === "activity" ? <div className={styles.detailBody}>{item.activities.map((activity) => <article key={activity.id}><p>{activity.label}</p><time>{activity.at}</time></article>)}</div> : null}
    {snapshot.role !== "viewer" ? <div className={styles.detailBody}><ActionForm snapshot={snapshot} item={item} operation="move_item"><select name="groupId" defaultValue={item.groupId} aria-label="이동할 그룹">{snapshot.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><button>업무 이동</button></ActionForm>{canManageStructure(snapshot.role) ? <ActionForm snapshot={snapshot} item={item} operation="delete_item"><button>업무 삭제</button></ActionForm> : null}</div> : null}
  </aside>;
}

export function WorkBoardSurface({ snapshot }: { snapshot: WorkBoardSnapshot }) {
  const [kind, setKind] = useState<WorkViewKind>("table"); const [query, setQuery] = useState(""); const [status, setStatus] = useState(""); const [sort, setSort] = useState<"group" | "due">("group"); const [selected, setSelected] = useState<WorkItemSnapshot | null>(null);
  const items = useMemo(() => visibleItems(snapshot, query, status, sort), [snapshot, query, status, sort]);
  return <div className={styles.shell}><header className={styles.header}><div><small>{snapshot.board.icon} {snapshot.board.templateKey} · v{snapshot.board.templateVersion}</small><h1>{snapshot.board.title}</h1><p>업무와 고객 정보는 분리된 정본을 실시간으로 연결합니다.</p></div><div className={styles.headerActions}>{canManageStructure(snapshot.role) ? <><ActionForm snapshot={snapshot} operation="create_group"><input name="value" placeholder="그룹 이름" aria-label="새 그룹 이름"/><button>+ 그룹</button></ActionForm><ActionForm snapshot={snapshot} operation="create_column"><input name="value" placeholder="컬럼 이름" aria-label="새 컬럼 이름"/><button>+ 컬럼</button></ActionForm></> : <><button disabled title="보드 관리자만 구조를 변경할 수 있습니다.">+ 그룹</button><button disabled title="보드 관리자만 구조를 변경할 수 있습니다.">+ 컬럼</button></>}{snapshot.role === "viewer" ? <button disabled title="업무 생성 권한이 없습니다.">+ 업무</button> : <ActionForm snapshot={snapshot} operation="create_item"><input name="value" placeholder="업무 이름" aria-label="새 업무 이름"/><button>+ 업무</button></ActionForm>}</div></header>
    <nav className={styles.views} aria-label="업무 보기">{(["table", "calendar", "gantt"] as const).map((view) => <button key={view} aria-current={kind === view ? "page" : undefined} onClick={() => setKind(view)}>{view === "table" ? "메인 테이블" : view === "calendar" ? "캘린더" : "간트"}</button>)}</nav>
    <section className={styles.toolbar} aria-label="업무 도구"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="업무·업체 검색" aria-label="업무 검색"/><select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="진행상황 필터"><option value="">전체 진행상황</option><option value="not_started">시작 전</option><option value="in_progress">작업 중</option><option value="done">완료</option><option value="blocked">차단</option></select><select value={sort} onChange={(e) => setSort(e.target.value as "group" | "due")} aria-label="업무 정렬"><option value="group">그룹순</option><option value="due">마감일순</option></select><ActionForm snapshot={snapshot} operation="save_personal_view"><input name="viewName" placeholder="보기 이름" aria-label="보기 이름" required/><input type="hidden" name="viewKind" value={kind}/><input type="hidden" name="predicate" value={JSON.stringify({ query, status, sort })}/><button>보기 저장</button></ActionForm><span>{items.length}개 업무</span></section>
    {items.length === 0 ? <div className={styles.empty}><h2>표시할 업무가 없습니다</h2><p>검색 또는 필터를 변경하거나 새 업무를 추가하세요.</p></div> : kind === "table" ? <TableView snapshot={snapshot} items={items} onOpen={setSelected}/> : kind === "calendar" ? <CalendarView snapshot={{ ...snapshot, items }} onOpen={setSelected}/> : <GanttView snapshot={{ ...snapshot, items }} onOpen={setSelected}/>} {selected ? <Detail snapshot={snapshot} item={selected} onClose={() => setSelected(null)}/> : null}
  </div>;
}
