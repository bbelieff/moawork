"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  reportingChainOf,
  wouldCreateDepartmentCycle,
  type DepartmentNode,
  type ReportingContext,
} from "@/lib/org/reporting";
import type { OrgChartState, OrgDepartmentView, OrgPersonView } from "@/lib/org/chart";
import { isUnavailableRpcError } from "./MemberOrganizationChart";

type ReadyState = Extract<OrgChartState, { kind: "ready" }>;

type BusyState = { kind: "idle" } | { kind: "busy"; key: string } | { kind: "error"; key: string; message: string } | { kind: "unavailable"; key: string };

/**
 * 조직도 — 부서 트리 + «보고가 올라가는 길» 점검 패널 (BBE-119).
 *
 * 설계 정본: docs/design/조직·보고체계_설계_v1.md §5-1
 * 부서를 만들고 사람을 배치하면 보고 대상은 **여기서 계산**한다(저장하지 않는다) —
 * `lib/org/reporting.ts` 의 순수 함수를 그대로 재사용한다(서버가 계산한 값과
 * 클라이언트 미리보기가 같은 알고리즘을 쓰게 하기 위해서다).
 *
 * ⚠ 목업(UI목업_워크스페이스_최종_v6.html)은 부서 카드를 드래그로 옮기지만, 이
 * 화면은 **선택형 이동 컨트롤**을 쓴다(같은 효과·다른 입력 방식) — 드래그앤드롭은
 * 이번 카드 수용 기준(부서 생성·배치·자동 보고 대상·즉시 반영·순환 차단)에
 * 없어 다음 라운드로 미룬 의도적 축소다.
 */
export function OrgChartView({ orgId, state }: { orgId: string; state: ReadyState }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | "unassigned" | null>(
    state.departments.find((d) => d.parentId === null)?.id ?? "unassigned",
  );
  const [busy, setBusy] = useState<BusyState>({ kind: "idle" });
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newParentId, setNewParentId] = useState("");
  const [newHeadUserId, setNewHeadUserId] = useState("");

  const ctx: ReportingContext = useMemo(
    () => ({
      departments: state.departments.map((d): DepartmentNode => ({ id: d.id, parentId: d.parentId, headUserId: d.headUserId })),
      primaryDeptOf: new Map(state.people.map((p) => [p.userId, p.deptId])),
      exceptionOf: new Map(state.people.map((p) => [p.userId, p.exceptionTargetUserId])),
      ownerUserId: state.ownerUserId,
    }),
    [state],
  );

  const nameOf = useMemo(() => new Map(state.people.map((p) => [p.userId, p.displayName])), [state.people]);
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, OrgDepartmentView[]>();
    for (const d of state.departments) {
      const list = map.get(d.parentId) ?? [];
      list.push(d);
      map.set(d.parentId, list);
    }
    return map;
  }, [state.departments]);
  const membersOf = useMemo(() => {
    const map = new Map<string, OrgPersonView[]>();
    for (const p of state.people) {
      if (!p.deptId) continue;
      const list = map.get(p.deptId) ?? [];
      list.push(p);
      map.set(p.deptId, list);
    }
    return map;
  }, [state.people]);
  const descendantCountOf = (deptId: string): number => {
    const kids = childrenOf.get(deptId) ?? [];
    return kids.reduce((sum, kid) => sum + 1 + descendantCountOf(kid.id), (membersOf.get(deptId) ?? []).length);
  };

  const roots = childrenOf.get(null) ?? [];
  const selectedDept = selectedId && selectedId !== "unassigned" ? state.departments.find((d) => d.id === selectedId) ?? null : null;

  async function runRpc(key: string, fn: string, args: Record<string, unknown>) {
    setBusy({ kind: "busy", key });
    const { error } = await createClient().rpc(fn, args);
    if (error) {
      setBusy(isUnavailableRpcError(error) ? { kind: "unavailable", key } : { kind: "error", key, message: error.message ?? "저장하지 못했어요." });
      return false;
    }
    setBusy({ kind: "idle" });
    router.refresh();
    return true;
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runRpc("create", "create_org_department", {
      p_org_id: orgId,
      p_parent_id: newParentId || null,
      p_name: newName.trim(),
      p_key: newKey.trim().toLowerCase(),
      p_head_user_id: newHeadUserId || null,
      p_request_id: crypto.randomUUID(),
    });
    setShowAddForm(false);
    setNewName("");
    setNewKey("");
    setNewHeadUserId("");
  }

  async function moveDepartment(deptId: string, newParentId: string) {
    await runRpc(`move-${deptId}`, "move_org_department", {
      p_org_id: orgId,
      p_dept_id: deptId,
      p_new_parent_id: newParentId || null,
      p_request_id: crypto.randomUUID(),
    });
  }

  async function setHead(deptId: string, headUserId: string) {
    await runRpc(`head-${deptId}`, "set_org_department_head", {
      p_org_id: orgId,
      p_dept_id: deptId,
      p_head_user_id: headUserId || null,
      p_request_id: crypto.randomUUID(),
    });
  }

  async function archiveDept(deptId: string) {
    await runRpc(`archive-${deptId}`, "archive_org_department", {
      p_org_id: orgId,
      p_dept_id: deptId,
      p_request_id: crypto.randomUUID(),
    });
  }

  async function assignMember(userId: string, deptId: string) {
    await runRpc(`assign-${userId}`, "assign_org_department_member", {
      p_org_id: orgId,
      p_dept_id: deptId,
      p_user_id: userId,
      p_request_id: crypto.randomUUID(),
    });
  }

  async function unassignMember(userId: string) {
    await runRpc(`unassign-${userId}`, "unassign_org_department_member", {
      p_org_id: orgId,
      p_user_id: userId,
      p_request_id: crypto.randomUUID(),
    });
  }

  function feedbackFor(key: string) {
    if (busy.kind === "error" && busy.key === key) return <p role="alert" className="mt-1 text-xs text-red-600">{busy.message}</p>;
    if (busy.kind === "unavailable" && busy.key === key) return <p role="alert" className="mt-1 text-xs text-zinc-500">아직 사용할 수 없어요 — 서버 준비가 끝난 뒤 다시 시도해 주세요.</p>;
    return null;
  }

  function DeptNode({ dept, depth }: { dept: OrgDepartmentView; depth: number }) {
    const kids = childrenOf.get(dept.id) ?? [];
    const members = membersOf.get(dept.id) ?? [];
    const selected = selectedId === dept.id;
    return (
      <li>
        <button
          type="button"
          onClick={() => setSelectedId(dept.id)}
          aria-current={selected ? "true" : undefined}
          className={`w-full rounded-xl border p-3 text-left ${selected ? "border-mw-primary" : "border-zinc-200 dark:border-zinc-800"}`}
          style={{ marginLeft: depth * 4 }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">{dept.name}</span>
            <span className="text-xs text-zinc-400">{members.length}명 직속</span>
          </div>
          <p className={`mt-0.5 text-xs ${dept.headUserId ? "text-zinc-500" : "text-mw-people"}`}>
            {dept.headUserId ? `책임자 · ${dept.headName ?? dept.headUserId}` : "공석 · 상위가 대행"}
          </p>
          {members.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {members.slice(0, 4).map((m) => (
                <span key={m.userId} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] dark:bg-zinc-800">{m.displayName}</span>
              ))}
              {members.length > 4 ? <span className="text-[11px] text-zinc-400">+{members.length - 4}명</span> : null}
            </div>
          ) : null}
        </button>
        {kids.length ? (
          <ul className="mt-2 flex flex-col gap-2 border-l border-zinc-200 pl-3 dark:border-zinc-800">
            {kids.map((kid) => <DeptNode key={kid.id} dept={kid} depth={depth + 1} />)}
          </ul>
        ) : null}
      </li>
    );
  }

  const unassignedPeople = state.unassigned;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-mw-primary bg-white p-3 text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-300">
        <b className="font-semibold">부서 트리가 진짜고, 보고선은 거기서 계산돼요.</b> 사람마다 보고 대상을 손으로
        지정하지 않아요 — 다른 부서로 옮기면 보고 대상이 즉시 따라와요. 부서장이 공석이면 보고는 자동으로 한 단계
        위로 갑니다.
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">조직도 <span className="text-xs font-normal text-zinc-400">부서 {state.departments.length}</span></h2>
            {state.canEdit ? (
              <button type="button" onClick={() => setShowAddForm((v) => !v)} className="rounded-xl border border-zinc-300 px-3 py-2 text-xs font-semibold dark:border-zinc-700">
                ＋ 부서 추가
              </button>
            ) : null}
          </div>

          {showAddForm ? (
            <form onSubmit={submitCreate} aria-label="부서 추가" className="mt-3 grid gap-2 rounded-xl border border-mw-primary p-3">
              <label className="grid gap-1 text-xs font-medium">부서명<input required value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" /></label>
              <label className="grid gap-1 text-xs font-medium">부서 키<input required value={newKey} onChange={(e) => setNewKey(e.target.value)} maxLength={96} pattern="[a-z0-9][a-z0-9:_./-]{0,95}" placeholder="예: sales.t2" className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" /></label>
              <label className="grid gap-1 text-xs font-medium">상위 부서
                <select value={newParentId} onChange={(e) => setNewParentId(e.target.value)} className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                  <option value="">없음(최상위)</option>
                  {state.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-medium">책임자(선택)
                <select value={newHeadUserId} onChange={(e) => setNewHeadUserId(e.target.value)} className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                  <option value="">공석으로 시작</option>
                  {state.people.map((p) => <option key={p.userId} value={p.userId}>{p.displayName}</option>)}
                </select>
              </label>
              {feedbackFor("create")}
              <div className="flex gap-2">
                <button type="submit" disabled={busy.kind === "busy" && busy.key === "create"} className="rounded-lg bg-mw-primary px-3 py-1.5 text-xs font-semibold text-mw-on-accent">
                  {busy.kind === "busy" && busy.key === "create" ? "만드는 중…" : "부서 만들기"}
                </button>
                <button type="button" onClick={() => setShowAddForm(false)} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs dark:border-zinc-700">취소</button>
              </div>
            </form>
          ) : null}

          <ul className="mt-3 flex flex-col gap-2">
            {roots.map((root) => <DeptNode key={root.id} dept={root} depth={0} />)}
          </ul>

          {unassignedPeople.length ? (
            <div className="mt-4 rounded-xl border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
              <button type="button" onClick={() => setSelectedId("unassigned")} className="text-xs font-semibold">
                미배정 {unassignedPeople.length}명 <span className="font-normal text-zinc-400">· 어느 부서에도 없어 대표에게 보고돼요</span>
              </button>
              <div className="mt-2 flex flex-wrap gap-1">
                {unassignedPeople.map((p) => <span key={p.userId} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] dark:bg-zinc-800">{p.displayName}</span>)}
              </div>
            </div>
          ) : null}
        </section>

        <aside className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          {selectedDept ? (
            <DeptInspector
              dept={selectedDept}
              depts={state.departments}
              members={membersOf.get(selectedDept.id) ?? []}
              allPeople={state.people}
              canEdit={state.canEdit}
              ctx={ctx}
              nameOf={nameOf}
              descendantCount={descendantCountOf(selectedDept.id)}
              busy={busy}
              feedbackFor={feedbackFor}
              onMove={moveDepartment}
              onSetHead={setHead}
              onArchive={archiveDept}
              onAssignMember={assignMember}
              onUnassignMember={unassignMember}
            />
          ) : (
            <UnassignedInspector
              people={unassignedPeople}
              depts={state.departments}
              canEdit={state.canEdit}
              busy={busy}
              feedbackFor={feedbackFor}
              onAssignMember={assignMember}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function DeptInspector({
  dept, depts, members, allPeople, canEdit, ctx, nameOf, descendantCount, busy, feedbackFor,
  onMove, onSetHead, onArchive, onAssignMember, onUnassignMember,
}: {
  dept: OrgDepartmentView;
  depts: OrgDepartmentView[];
  members: OrgPersonView[];
  allPeople: OrgPersonView[];
  canEdit: boolean;
  ctx: ReportingContext;
  nameOf: ReadonlyMap<string, string>;
  descendantCount: number;
  busy: BusyState;
  feedbackFor: (key: string) => React.ReactNode;
  onMove: (deptId: string, newParentId: string) => void;
  onSetHead: (deptId: string, headUserId: string) => void;
  onArchive: (deptId: string) => void;
  onAssignMember: (userId: string, deptId: string) => void;
  onUnassignMember: (userId: string) => void;
}) {
  const parent = dept.parentId ? depts.find((d) => d.id === dept.parentId) : null;
  const moveTargets = depts.filter((d) => d.id !== dept.id && !wouldCreateDepartmentCycle(depts.map((x) => ({ id: x.id, parentId: x.parentId, headUserId: x.headUserId })), dept.id, d.id));
  const chainSample = dept.headUserId ?? members[0]?.userId ?? null;
  const chain = chainSample ? reportingChainOf(chainSample, ctx) : [];
  const canArchive = descendantCount === 0 && (depts.filter((d) => d.parentId === dept.id).length === 0);

  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-semibold">{dept.name}</h2>
      <dl className="grid gap-1 text-xs text-zinc-500">
        <div className="flex justify-between"><dt>상위 부서</dt><dd>{parent ? parent.name : "없음(최상위)"}</dd></div>
        <div className="flex justify-between"><dt>직속 / 하위 포함</dt><dd>{members.length}명 / {descendantCount}명</dd></div>
        <div className="flex justify-between"><dt>부서 키</dt><dd><code>{dept.key}</code></dd></div>
      </dl>

      <div>
        <p className="text-xs font-semibold text-zinc-500">보고가 올라가는 길</p>
        <p className="mt-1 text-xs">
          {chainSample ? (nameOf.get(chainSample) ?? chainSample) : "직속 인원 없음"}
          {chain.map((id) => <span key={id}> → {nameOf.get(id) ?? id}</span>)}
          {chainSample && chain.length === 0 ? <span className="text-zinc-400"> — 최상위(더 올라가지 않음)</span> : null}
        </p>
        {!dept.headUserId ? <p className="mt-1 text-[11px] text-mw-people">이 부서는 공석이라 한 단계 건너뛰어 올라가요.</p> : null}
      </div>

      {canEdit ? (
        <div className="grid gap-2 rounded-xl border border-zinc-200 p-2.5 text-xs dark:border-zinc-800">
          <label className="grid gap-1">책임자
            <select
              value={dept.headUserId ?? ""}
              onChange={(e) => onSetHead(dept.id, e.target.value)}
              disabled={busy.kind === "busy" && busy.key === `head-${dept.id}`}
              className="rounded-lg border border-zinc-300 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="">공석</option>
              {members.map((m) => <option key={m.userId} value={m.userId}>{m.displayName}</option>)}
            </select>
          </label>
          {feedbackFor(`head-${dept.id}`)}

          <label className="grid gap-1">다른 부서로 이동
            <select
              defaultValue=""
              onChange={(e) => { if (e.target.value) onMove(dept.id, e.target.value === "__root__" ? "" : e.target.value); }}
              disabled={busy.kind === "busy" && busy.key === `move-${dept.id}`}
              className="rounded-lg border border-zinc-300 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="">이동할 곳 선택…</option>
              <option value="__root__">없음(최상위)</option>
              {moveTargets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          {feedbackFor(`move-${dept.id}`)}

          <button
            type="button"
            onClick={() => onArchive(dept.id)}
            disabled={!canArchive || (busy.kind === "busy" && busy.key === `archive-${dept.id}`)}
            title={canArchive ? undefined : "하위 부서·소속 인원을 먼저 옮기세요"}
            className="rounded-lg border border-zinc-300 px-2 py-1.5 text-left disabled:opacity-40 dark:border-zinc-700"
          >
            부서 보관
          </button>
          {feedbackFor(`archive-${dept.id}`)}
        </div>
      ) : null}

      <div>
        <p className="text-xs font-semibold text-zinc-500">이 부서 사람</p>
        {members.length ? (
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center justify-between gap-2 text-xs">
                <span>{m.displayName}{m.isDeptHead ? <span className="ml-1 text-[10px] text-mw-primary">책임자</span> : null}</span>
                <span className="text-zinc-400">→ {m.reportsToName ?? "없음"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-zinc-400">직속 인원이 없습니다.</p>
        )}
      </div>

      {canEdit ? (
        <MemberAssignPicker
          people={allPeople.filter((p) => p.deptId !== dept.id)}
          onAssign={(userId) => onAssignMember(userId, dept.id)}
          onUnassign={(userId) => onUnassignMember(userId)}
          currentMembers={members}
          busy={busy}
          feedbackFor={feedbackFor}
        />
      ) : null}
    </div>
  );
}

function UnassignedInspector({
  people, depts, canEdit, busy, feedbackFor, onAssignMember,
}: {
  people: OrgPersonView[];
  depts: OrgDepartmentView[];
  canEdit: boolean;
  busy: BusyState;
  feedbackFor: (key: string) => React.ReactNode;
  onAssignMember: (userId: string, deptId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-semibold">미배정 {people.length}명</h2>
      <p className="text-xs text-zinc-500">어느 부서에도 없는 사람이에요. 목록에서 사라지지 않고, 보고는 대표에게 갑니다.</p>
      {people.length === 0 ? <p className="text-xs text-zinc-400">모두 부서가 있어요.</p> : (
        <ul className="flex flex-col gap-2">
          {people.map((p) => (
            <li key={p.userId} className="rounded-xl border border-zinc-200 p-2 text-xs dark:border-zinc-800">
              <p className="font-semibold">{p.displayName}</p>
              {canEdit ? (
                <>
                  <select
                    defaultValue=""
                    onChange={(e) => { if (e.target.value) onAssignMember(p.userId, e.target.value); }}
                    disabled={busy.kind === "busy" && busy.key === `assign-${p.userId}`}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <option value="">부서 배정…</option>
                    {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  {feedbackFor(`assign-${p.userId}`)}
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MemberAssignPicker({
  people, onAssign, onUnassign, currentMembers, busy, feedbackFor,
}: {
  people: OrgPersonView[];
  onAssign: (userId: string) => void;
  onUnassign: (userId: string) => void;
  currentMembers: OrgPersonView[];
  busy: BusyState;
  feedbackFor: (key: string) => React.ReactNode;
}) {
  const [pickUserId, setPickUserId] = useState("");
  return (
    <div className="rounded-xl border border-zinc-200 p-2.5 text-xs dark:border-zinc-800">
      <label className="grid gap-1">이 부서로 사람 추가
        <div className="flex gap-1.5">
          <select value={pickUserId} onChange={(e) => setPickUserId(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900">
            <option value="">사람 선택…</option>
            {people.map((p) => <option key={p.userId} value={p.userId}>{p.displayName}{p.deptName ? ` (현재: ${p.deptName})` : ""}</option>)}
          </select>
          <button type="button" onClick={() => pickUserId && onAssign(pickUserId)} disabled={!pickUserId} className="shrink-0 rounded-lg bg-mw-primary px-2.5 py-1.5 font-semibold text-mw-on-accent disabled:opacity-40">추가</button>
        </div>
      </label>
      {pickUserId ? feedbackFor(`assign-${pickUserId}`) : null}
      {currentMembers.length ? (
        <div className="mt-2 flex flex-col gap-1">
          {currentMembers.map((m) => (
            <div key={m.userId}>
              <div className="flex items-center justify-between">
                <span>{m.displayName}</span>
                <button type="button" onClick={() => onUnassign(m.userId)} disabled={busy.kind === "busy" && busy.key === `unassign-${m.userId}`} className="text-[11px] text-zinc-400 underline">
                  미배정으로
                </button>
              </div>
              {feedbackFor(`unassign-${m.userId}`)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
