"use client";

import { type FormEvent, useState, useTransition } from "react";
import {
  assignDepartmentMemberAction,
  createDepartmentAction,
  moveDepartmentAction,
  renameDepartmentAction,
  type DepartmentActionState,
} from "@/app/(app)/settings/members/department-actions";
import { toTree, type DepartmentNode, type OrgChart } from "@/lib/org/departments";

export type DepartmentManagerActionSet = Readonly<{
  create: (formData: FormData) => Promise<DepartmentActionState>;
  rename: (formData: FormData) => Promise<DepartmentActionState>;
  move: (formData: FormData) => Promise<DepartmentActionState>;
  assign: (formData: FormData) => Promise<DepartmentActionState>;
}>;

type Props = Readonly<{
  chart: OrgChart;
  canManage: boolean;
  actions?: DepartmentManagerActionSet;
}>;
type Feedback = DepartmentActionState | null;

const CARD = "rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950";

function SubmitForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  onResult,
  className = "grid gap-2",
}: {
  action: (formData: FormData) => Promise<DepartmentActionState>;
  children: React.ReactNode;
  submitLabel: string;
  pendingLabel: string;
  onResult: (state: DepartmentActionState) => void;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      const state = await action(formData);
      onResult(state);
      if (state.ok && form.dataset.resetOnSuccess === "true") form.reset();
    });
  };
  return (
    <form className={className} onSubmit={submit}>
      {children}
      <button type="submit" disabled={pending} className="h-9 rounded-lg bg-mw-primary px-3 text-sm font-semibold text-mw-on-accent disabled:opacity-60">
        {pending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}

function DepartmentSelect({ departments, value, excludeId, name = "parentId" }: {
  departments: readonly DepartmentNode[];
  value: string | null;
  excludeId?: string;
  name?: string;
}) {
  return (
    <select name={name} defaultValue={value ?? ""} className="h-9 min-w-0 rounded-lg border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700">
      <option value="">최상위</option>
      {departments.filter((department) => department.id !== excludeId).map((department) => (
        <option key={department.id} value={department.id}>{department.name}</option>
      ))}
    </select>
  );
}

const DEFAULT_ACTIONS: DepartmentManagerActionSet = {
  create: createDepartmentAction,
  rename: renameDepartmentAction,
  move: moveDepartmentAction,
  assign: assignDepartmentMemberAction,
};

export function DepartmentManager({ chart, canManage, actions = DEFAULT_ACTIONS }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(chart.kind === "ready" ? chart.departments[0]?.id ?? null : null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  if (chart.kind === "error") {
    return (
      <section role="alert" data-department-manager="error" className={`${CARD} p-5`}>
        <h2 className="font-semibold">조직도를 불러오지 못했어요</h2>
        <p className="mt-1 text-sm text-zinc-500">부서가 없는 상태와는 달라요. 잠시 후 다시 시도해 주세요.</p>
      </section>
    );
  }

  const rows = toTree(chart.departments, chart.members);
  const activeMembers = chart.members.filter((member) => member.active);
  const selected = chart.departments.find((department) => department.id === selectedId) ?? chart.departments[0] ?? null;
  const currentDepartmentByUser = new Map<string, string>();
  for (const member of activeMembers) {
    const primary = member.primaryDepartmentId;
    if (primary) currentDepartmentByUser.set(member.userId, primary);
  }

  const report = (state: DepartmentActionState) => setFeedback(state);

  return (
    <section aria-labelledby="department-manager-title" data-department-manager="ready" className={`${CARD} overflow-hidden`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div>
          <h2 id="department-manager-title" className="text-base font-semibold">조직도 관리</h2>
          <p className="mt-1 text-sm text-zinc-500">부서 구조와 사람의 주부서를 한 화면에서 정리해요.</p>
        </div>
        <div className="flex gap-2 text-xs tabular-nums text-zinc-500">
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 dark:bg-zinc-900">부서 {chart.departments.length}</span>
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 dark:bg-zinc-900">조직원 {activeMembers.length}</span>
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800 dark:bg-amber-950 dark:text-amber-200">주부서 미지정 {chart.unassignedCount}</span>
        </div>
      </header>

      {feedback ? (
        <p role={feedback.ok ? "status" : "alert"} className={`mx-5 mt-4 rounded-lg px-3 py-2 text-sm ${feedback.ok ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"}`}>
          {feedback.message}
        </p>
      ) : null}

      <div className="grid min-h-[390px] md:grid-cols-[minmax(260px,0.85fr)_minmax(0,1.45fr)]">
        <div className="border-b border-zinc-200 p-4 md:border-b-0 md:border-r dark:border-zinc-800">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">부서 구조</h3>
            {!canManage ? <span className="text-xs text-zinc-500">조회만 가능</span> : null}
          </div>

          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-7 text-center dark:border-zinc-700">
              <p className="font-medium">아직 부서가 없어요</p>
              <p className="mt-1 text-sm text-zinc-500">예시 부서는 만들지 않아요. 회사에 맞는 첫 부서를 직접 만들어 주세요.</p>
            </div>
          ) : (
            <ul className="space-y-1" aria-label="부서 트리">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(row.id)}
                    aria-pressed={selected?.id === row.id}
                    className={`flex w-full items-center gap-2 rounded-lg py-2 pr-2 text-left text-sm ${selected?.id === row.id ? "bg-mw-tint-purple text-mw-primary" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"}`}
                    style={{ paddingLeft: `${10 + row.depth * 18}px` }}
                  >
                    <span aria-hidden="true" className="text-zinc-400">{row.depth === 0 ? "▾" : "└"}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
                    <span className="text-xs tabular-nums text-zinc-500" title="직접 배정 / 하위 포함">{row.memberCount}{row.reachCount !== row.memberCount ? ` / ${row.reachCount}` : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {canManage ? (
            <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <h3 className="mb-2 text-sm font-semibold">새 부서</h3>
              <SubmitForm key={`create-${selected?.id ?? "root"}`} action={actions.create} submitLabel="부서 만들기" pendingLabel="만드는 중…" onResult={report}>
                <input name="name" required maxLength={80} placeholder="부서 이름" aria-label="새 부서 이름" className="h-9 min-w-0 rounded-lg border border-zinc-300 bg-transparent px-3 text-sm dark:border-zinc-700" />
                <DepartmentSelect departments={chart.departments} value={selected?.id ?? null} />
              </SubmitForm>
            </div>
          ) : null}
        </div>

        <div className="min-w-0 p-4">
          {selected ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs text-zinc-500">선택한 부서</p>
                  <h3 className="text-lg font-semibold">{selected.name}</h3>
                </div>
                <span className="rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-500 dark:border-zinc-800">직접 배정 {selected.memberCount}명</span>
              </div>

              {canManage ? (
                <div className="grid gap-3 rounded-xl bg-zinc-50 p-3 sm:grid-cols-2 dark:bg-zinc-900">
                  <SubmitForm key={`rename-${selected.id}-${selected.name}`} action={actions.rename} submitLabel="이름 저장" pendingLabel="저장 중…" onResult={report}>
                    <input type="hidden" name="departmentId" value={selected.id} />
                    <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">부서 이름<input name="name" defaultValue={selected.name} required maxLength={80} className="h-9 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-950 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white" /></label>
                  </SubmitForm>
                  <SubmitForm key={`move-${selected.id}-${selected.parentId ?? "root"}`} action={actions.move} submitLabel="위치 저장" pendingLabel="저장 중…" onResult={report}>
                    <input type="hidden" name="departmentId" value={selected.id} />
                    <label className="grid gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">상위 부서<DepartmentSelect departments={chart.departments} value={selected.parentId} excludeId={selected.id} /></label>
                  </SubmitForm>
                </div>
              ) : (
                <p className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">대표와 관리자가 구조와 사람 배정을 바꿀 수 있어요.</p>
              )}

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold">조직원 주부서</h4>
                  <span className="text-xs text-zinc-500">활동 중인 구성원만 표시</span>
                </div>
                {activeMembers.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">배정할 활동 구성원이 없어요.</p>
                ) : (
                  <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-900 dark:border-zinc-800">
                    {activeMembers.map((member) => (
                      <li key={member.userId} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-mw-tint-purple text-xs font-bold text-mw-primary">{member.displayName.slice(0, 1)}</span>
                        <div className="min-w-28 flex-1">
                          <p className="truncate text-sm font-medium">{member.displayName}</p>
                          <p className="text-xs text-zinc-500">{currentDepartmentByUser.has(member.userId) ? "주부서 배정됨" : "주부서 미지정"}</p>
                        </div>
                        {canManage ? (
                          <SubmitForm action={actions.assign} submitLabel="저장" pendingLabel="저장 중…" onResult={report} className="flex min-w-[240px] items-center gap-2">
                            <input type="hidden" name="userId" value={member.userId} />
                            <select name="departmentId" defaultValue={currentDepartmentByUser.get(member.userId) ?? ""} aria-label={`${member.displayName} 주부서`} className="h-9 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700">
                              <option value="">주부서 미지정</option>
                              {chart.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                            </select>
                          </SubmitForm>
                        ) : (
                          <span className="text-sm text-zinc-500">{chart.departments.find((department) => department.id === currentDepartmentByUser.get(member.userId))?.name ?? "주부서 미지정"}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <div className="flex min-h-[300px] items-center justify-center text-center">
              <div>
                <p className="font-medium">첫 부서를 만들면 여기에 상세 설정이 나타나요.</p>
                <p className="mt-1 text-sm text-zinc-500">새 워크스페이스는 부서 0개로 시작합니다.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
