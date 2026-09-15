// BBE-186 · 홈 «오늘» — 순수 프레젠테이션(조회 없음).
//
// 정본: docs/design/UI목업_워크스페이스_최종_v6.html:1528~1570 (T.dash)
//   KPI 5 → 아래 1fr/340px 2단 → 좌 «내 할 일», 우 «최근 알림» + «바로 가기».
// 데이터는 전부 BBE-185 스냅샷에서만 온다. 이 파일에 숫자·업체명 상수를 두지 않는다(§9.3).
//
// 색·간격·글자크기는 토큰만 참조한다 — app/src/styles/moawork-tokens.css.

import Link from "next/link";
import type { TodayDashboardNotification, TodayDashboardSnapshot, TodayDashboardTask } from "@/lib/dash/today";
import type { TodayHomeState } from "@/lib/dash/today-server";
import {
  HOME_KPIS,
  HOME_SHORTCUTS,
  dueBadge,
  formatKpi,
  taskTabLabel,
  taskWhat,
  type DueTone,
} from "@/lib/dash/today-view";

const PANE = "rounded-[var(--mw-r-3)] border border-[var(--mw-bd)] bg-[var(--mw-s-2)]";
const PANE_TITLE =
  "flex min-h-10 items-center gap-[var(--sp-2)] border-b border-[var(--mw-bd)] px-[var(--sp-3)] py-[var(--sp-2)] text-[length:var(--fs-13)] font-semibold text-[var(--mw-t-1)]";

/** 목업 §missingSources 라벨 — 사이드바 어휘와 맞춘다. */
const SOURCE_LABEL: Record<TodayDashboardSnapshot["missingSources"][number], string> = {
  "new-lead": "신규리드 관리",
  contact: "리드컨택 관리",
  work: "계약업체 실무",
};


const DUE_TONE_CLASS: Record<DueTone, string> = {
  overdue: "bg-[var(--mw-badge-reject-bg)] text-[var(--mw-badge-reject-fg)]",
  today: "bg-[var(--mw-badge-caution-bg)] text-[var(--mw-badge-caution-fg)]",
  upcoming: "bg-[var(--mw-badge-neutral-bg)] text-[var(--mw-badge-neutral-fg)]",
};

function Pane({ title, right, children }: { title: string; right?: string; children: React.ReactNode }) {
  return (
    <section className={PANE}>
      <h2 className={PANE_TITLE}>
        {title}
        {right ? (
          <span className="ml-auto text-[length:var(--fs-12)] font-normal text-[var(--mw-t-3)]">{right}</span>
        ) : null}
      </h2>
      {children}
    </section>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-[var(--sp-3)] py-[var(--sp-4)] text-[length:var(--fs-12)] leading-[var(--lh-prose)] text-[var(--mw-t-3)]">
      {children}
    </p>
  );
}

function KpiRow({ kpis }: { kpis: TodayDashboardSnapshot["kpis"] }) {
  return (
    <ul className="grid grid-cols-2 gap-[var(--sp-3)] sm:grid-cols-3 xl:grid-cols-5">
      {HOME_KPIS.map((kpi) => (
        <li key={kpi.key} className={`${PANE} px-[var(--sp-3)] py-[var(--sp-3)]`}>
          <div className="text-[length:var(--fs-12)] text-[var(--mw-t-3)]">{kpi.label}</div>
          <div className="mt-[var(--sp-1)] text-[length:var(--fs-22)] font-semibold tabular-nums text-[var(--mw-t-1)]">
            {formatKpi(kpi, kpis)}
          </div>
        </li>
      ))}
    </ul>
  );
}

function TaskPane({ tasks, today }: { tasks: readonly TodayDashboardTask[]; today: string }) {
  return (
    <Pane title="내 할 일">
      {tasks.length === 0 ? (
        <Hint>
          오늘 처리할 업무가 없습니다.

        </Hint>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[length:var(--fs-13)] text-[var(--mw-t-1)]">
            <thead>
              <tr className="text-left text-[length:var(--fs-12)] font-normal text-[var(--mw-t-3)]">
                <th scope="col" className="w-[190px] px-[var(--sp-3)] py-[var(--sp-2)] font-normal">업체</th>
                <th scope="col" className="px-[var(--sp-3)] py-[var(--sp-2)] font-normal">할 일</th>
                <th scope="col" className="w-[130px] px-[var(--sp-3)] py-[var(--sp-2)] font-normal">탭</th>
                <th scope="col" className="w-[92px] px-[var(--sp-3)] py-[var(--sp-2)] font-normal">기한</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => {
                const due = dueBadge(task.dueOn, today);
                return (
                  <tr key={task.itemId} className="border-t border-[var(--mw-bd)]">
                    <td className="px-[var(--sp-3)] py-[var(--sp-2)]">
                      <Link
                        href={task.href}
                        className="font-semibold underline-offset-2 hover:underline focus-visible:underline"
                      >
                        {task.title}
                      </Link>
                    </td>
                    <td className="px-[var(--sp-3)] py-[var(--sp-2)] text-[var(--mw-t-2)]">{taskWhat(task)}</td>
                    <td className="px-[var(--sp-3)] py-[var(--sp-2)] text-[var(--mw-t-3)]">{taskTabLabel(task.href)}</td>
                    <td className="px-[var(--sp-3)] py-[var(--sp-2)]">
                      <span
                        className={`inline-flex rounded-[var(--mw-r-1)] px-[var(--sp-2)] py-[2px] text-[length:var(--fs-12)] tabular-nums ${DUE_TONE_CLASS[due.tone]}`}
                      >
                        {due.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Pane>
  );
}

function NotificationPane({ notifications }: { notifications: readonly TodayDashboardNotification[] }) {
  return (
    <Pane title="최근 알림">
      {notifications.length === 0 ? (
        <Hint>
          아직 없습니다.
          <br />
          신규리드 관리에서 상태를 바꾸면 여기에 쌓입니다.
        </Hint>
      ) : (
        <ul className="px-[var(--sp-3)] py-[var(--sp-2)]">
          {notifications.map((notification) => (
            <li key={notification.id} className="border-b border-[var(--mw-bd)] last:border-b-0">
              <Link
                href={notification.href}
                className="block py-[var(--sp-2)] text-[length:var(--fs-12)] leading-[var(--lh-prose)] text-[var(--mw-t-2)] underline-offset-2 hover:underline focus-visible:underline"
              >
                <span className="font-semibold text-[var(--mw-t-1)]">{notification.title}</span>
                {notification.body ? <span> · {notification.body}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Pane>
  );
}

function ShortcutPane() {
  return (
    <Pane title="바로 가기">
      <ul className="flex flex-col gap-[var(--sp-2)] p-[var(--sp-3)]">
        {HOME_SHORTCUTS.map((shortcut) => (
          <li key={shortcut.href}>
            <Link
              href={shortcut.href}
              className="flex min-h-[var(--mw-hit-min)] items-center rounded-[var(--mw-r-2)] border border-[var(--mw-bd)] px-[var(--sp-3)] text-[length:var(--fs-13)] text-[var(--mw-t-1)] hover:border-[var(--mw-bd-2)] hover:bg-[var(--mw-s-1)] focus-visible:border-[var(--mw-bd-2)]"
            >
              {shortcut.label}
            </Link>
          </li>
        ))}
      </ul>
    </Pane>
  );
}

/** 연결 안 됨 / 읽기 실패 — 흰 화면 대신 사유와 다음 행동을 보여준다. */
function Unavailable({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      role="status"
      className={`${PANE} px-[var(--sp-4)] py-[var(--sp-4)] text-[length:var(--fs-13)] leading-[var(--lh-prose)] text-[var(--mw-t-2)]`}
    >
      <strong className="block font-semibold text-[var(--mw-t-1)]">{title}</strong>
      {children}
    </section>
  );
}

export function TodayHome({ state }: { state: TodayHomeState }) {
  if (state.kind === "unconfigured") {
    return (
      <Unavailable title="워크스페이스 데이터에 아직 연결되지 않았습니다">
        오늘 지표는 워크스페이스 데이터베이스에서 옵니다. 연결되면 KPI·내 할 일·최근 알림이 여기에 바로 나옵니다.
      </Unavailable>
    );
  }
  if (state.kind === "error") {
    return (
      <Unavailable title="오늘 지표를 불러오지 못했습니다">
        잠시 후 새로고침해 주세요. 계속되면 관리자에게 알려 주세요.
        <span className="mt-[var(--sp-2)] block text-[length:var(--fs-12)] text-[var(--mw-t-3)]">사유: {state.reason}</span>
      </Unavailable>
    );
  }

  const { snapshot } = state;
  return (
    <div className="flex flex-col gap-[var(--sp-4)]">
      {snapshot.status === "partial" && snapshot.missingSources.length > 0 ? (
        <p
          role="status"
          className="rounded-[var(--mw-r-2)] border border-[var(--mw-bd)] bg-[var(--mw-s-1)] px-[var(--sp-3)] py-[var(--sp-2)] text-[length:var(--fs-12)] text-[var(--mw-t-2)]"
        >
          일부 탭이 아직 없어 그만큼은 빠진 숫자입니다 — {snapshot.missingSources.map((s) => SOURCE_LABEL[s]).join(" · ")}
        </p>
      ) : null}
      <KpiRow kpis={snapshot.kpis} />

      <div className="grid gap-[var(--sp-3)] lg:grid-cols-[minmax(0,1fr)_340px]">
        <TaskPane tasks={snapshot.tasks} today={snapshot.period.today} />
        <div className="flex flex-col gap-[var(--sp-3)]">
          <NotificationPane notifications={snapshot.notifications} />
          <ShortcutPane />
        </div>
      </div>
    </div>
  );
}
