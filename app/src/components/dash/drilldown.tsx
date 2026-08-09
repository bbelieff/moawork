import Link from "next/link";
import type { Deal, Pipeline } from "@/lib/types";
import {
  dashboardHref,
  dueDateOf,
  type DashboardFilters,
} from "@/lib/dash/drilldown";
import {
  completeTodayTaskAction,
  postponeTodayTaskAction,
  reassignTodayTaskAction,
} from "@/app/(app)/dash/actions";

export interface AssigneeOption {
  id: string;
  label: string;
}

export function DashboardFilterBar({
  filters,
  pipelines,
  assignees,
}: {
  filters: DashboardFilters;
  pipelines: Pipeline[];
  assignees: AssigneeOption[];
}) {
  return (
    <form className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5 dark:border-zinc-800 dark:bg-zinc-950">
      <label className="text-xs text-zinc-500">
        시작일
        <input name="from" type="date" defaultValue={filters.from ?? ""} className="mt-1 w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm dark:border-zinc-700" />
      </label>
      <label className="text-xs text-zinc-500">
        종료일
        <input name="to" type="date" defaultValue={filters.to ?? ""} className="mt-1 w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm dark:border-zinc-700" />
      </label>
      <label className="text-xs text-zinc-500">
        담당자
        <select name="assignee" defaultValue={filters.assignee ?? ""} className="mt-1 w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm dark:border-zinc-700">
          <option value="">전체 담당자</option>
          {assignees.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <label className="text-xs text-zinc-500">
        파이프라인
        <select name="pipeline" defaultValue={filters.pipeline ?? ""} className="mt-1 w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm dark:border-zinc-700">
          <option value="">전체 파이프라인</option>
          {pipelines.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <div className="flex items-end gap-2">
        <input type="hidden" name="metric" value={filters.metric} />
        <button className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">필터 적용</button>
        <Link href="/dash/tasks" className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700">초기화</Link>
      </div>
    </form>
  );
}

export function DashboardStateNotice({
  result,
  overdueCount,
}: {
  result: string | null;
  overdueCount: number;
}) {
  if (result === "partial") return <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">업무는 저장됐지만 활동 기록 일부를 남기지 못했어요. 업무 값은 새로고침해 확인해 주세요.</p>;
  if (result === "failed") return <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">변경을 저장하지 못했어요. 권한과 연결 상태를 확인하고 다시 시도해 주세요.</p>;
  if (result) return <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">변경 내용을 저장했어요.</p>;
  if (overdueCount > 0) return <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">기한이 지난 업무가 {overdueCount}건 있어요. 아래 근거 목록에서 바로 확인할 수 있어요.</p>;
  return null;
}

export function DashboardEvidenceList({
  deals,
  pipelines,
}: {
  deals: Deal[];
  pipelines: Pipeline[];
}) {
  if (deals.length === 0) return <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">선택한 조건에 맞는 업무가 0건이에요. 기간이나 필터를 바꿔 보세요.</div>;
  const pipelineLabel = (id: string | null) => pipelines.find((item) => item.id === id)?.name ?? "파이프라인 미지정";
  return (
    <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {deals.map((deal) => (
        <li key={deal.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <Link href={`/deals/${deal.id}`} className="font-medium hover:underline">{deal.title}</Link>
          <span className="text-xs text-zinc-500">{pipelineLabel(deal.pipeline_id)} · {dueDateOf(deal) ?? "마감일 미정"}</span>
        </li>
      ))}
    </ul>
  );
}

export function TodayTaskList({
  deals,
  assignees,
  canChangeAssignee,
  returnTo,
  today,
}: {
  deals: Deal[];
  assignees: AssigneeOption[];
  canChangeAssignee: boolean;
  returnTo: string;
  today: string;
}) {
  if (deals.length === 0) return <p className="rounded-xl border border-dashed border-zinc-300 p-5 text-sm text-zinc-500 dark:border-zinc-700">오늘 처리할 업무가 0건이에요.</p>;
  return (
    <ul className="space-y-3">
      {deals.map((deal) => (
        <li key={deal.id} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="mb-3 flex items-center justify-between gap-2">
            <Link href={`/deals/${deal.id}`} className="font-medium hover:underline">{deal.title}</Link>
            <span className="text-xs text-zinc-500">오늘 마감</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <form action={completeTodayTaskAction}>
              <input type="hidden" name="dealId" value={deal.id} /><input type="hidden" name="returnTo" value={returnTo} />
              <button className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white">완료</button>
            </form>
            <form action={postponeTodayTaskAction} className="flex gap-2">
              <input type="hidden" name="dealId" value={deal.id} /><input type="hidden" name="returnTo" value={returnTo} />
              <input required name="dueDate" type="date" min={today} className="rounded-lg border border-zinc-200 bg-transparent px-2 py-1 text-xs dark:border-zinc-700" />
              <button className="rounded-lg border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">연기</button>
            </form>
            {canChangeAssignee ? (
              <form action={reassignTodayTaskAction} className="flex gap-2">
                <input type="hidden" name="dealId" value={deal.id} /><input type="hidden" name="returnTo" value={returnTo} />
                <select name="assignee" defaultValue={deal.assigned_to ?? ""} className="rounded-lg border border-zinc-200 bg-transparent px-2 py-1 text-xs dark:border-zinc-700">
                  <option value="">담당자 미정</option>{assignees.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
                <button className="rounded-lg border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">담당 변경</button>
              </form>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function MetricTabs({ filters }: { filters: DashboardFilters }) {
  const items = [["all", "전체 근거"], ["today", "오늘 할 일"], ["overdue", "기한 지남"], ["new", "오늘 등록"]] as const;
  return <nav className="flex flex-wrap gap-2" aria-label="대시보드 근거 목록"><span className="sr-only">지표 선택</span>{items.map(([metric, label]) => <Link key={metric} href={dashboardHref(filters, { metric })} className={`rounded-full px-3 py-1.5 text-sm ${filters.metric === metric ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-200 dark:border-zinc-700"}`}>{label}</Link>)}</nav>;
}
