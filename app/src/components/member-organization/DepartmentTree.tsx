import type { ReactElement } from "react";
import { toTree, type OrgChart } from "@/lib/org/departments";

/**
 * #571 — 조직관리의 «조직도».
 *
 * 목업(T.member)은 이 화면의 중심이 부서 트리다 — 부제부터 「조직도 · 조직원 · 보고 계통 · 알림 대상」.
 * 제품에는 그 개념이 아예 없어서 대표/팀장/사원 평평한 목록만 있었다. 그 자리를 채운다.
 *
 * 이 1차에서 «안 하는 것» 을 분명히 한다
 *   · 부서를 만들고 옮기는 조작은 다음 단계다. 지금은 «보이게» 까지다.
 *   · 조직도 시각화(가로 트리)·알림 규칙 pane 도 다음이다.
 *   화면에 그 사실을 적어 둔다 — 없는 것을 «곧 나온다» 고 말하지 않고 «아직 없다» 고 말한다.
 */
const CARD = "rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950";

export function DepartmentTree({ chart }: { chart: OrgChart }): ReactElement {
  if (chart.kind === "error") {
    return (
      <section role="alert" className={`${CARD} p-4`}>
        <h2 className="text-sm font-semibold">조직도를 불러오지 못했어요</h2>
        {/* «못 읽었다» 와 «부서가 없다» 를 다르게 말한다 — 빈 조직도로 위장하지 않는다. */}
        <p className="mt-1 text-sm text-zinc-500">잠시 후 다시 시도해 주세요. 부서가 없는 것과는 다른 상태예요.</p>
      </section>
    );
  }

  const rows = toTree(chart.departments, chart.members);

  return (
    <section aria-labelledby="org-chart-title" className={`${CARD} p-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-100 pb-3 dark:border-zinc-900">
        <h2 id="org-chart-title" className="text-sm font-semibold">조직도</h2>
        <span className="text-xs text-zinc-500">
          부서 {chart.departments.length} · 조직원 {chart.members.filter((member) => member.active).length} · 미배정 {chart.unassignedCount}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="py-8 text-center">
          <p className="font-medium">아직 부서가 없어요</p>
          {/* 막다른 길을 만들지 않는다 — «왜 비어 있는가» 와 «다음이 무엇인가» 를 같이 말한다. */}
          <p className="mt-1 text-sm text-zinc-500">
            회사마다 조직도가 다르기 때문에 제품이 부서를 미리 만들어 두지 않아요.
            <br />
            부서를 만드는 기능은 준비 중이에요.
          </p>
        </div>
      ) : (
        <ul className="mt-2 flex flex-col">
          {rows.map((row) => {
            const head = row.headUserId
              ? chart.members.find((member) => member.userId === row.headUserId)?.displayName
              : null;
            return (
              <li
                key={row.id}
                data-department-id={row.id}
                className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                // 들여쓰기로 «보고 계통» 을 보여준다. 목업도 같은 방식이다.
                style={{ paddingLeft: `${8 + row.depth * 16}px` }}
              >
                <span aria-hidden="true" className="text-zinc-300">{row.depth === 0 ? "▾" : "·"}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.name}</span>
                {head ? (
                  <span className="text-[11px] text-zinc-500">책임자 {head}</span>
                ) : (
                  // 목업이 명시적으로 그리는 문구다 — 공석이면 보고가 상위로 넘어간다.
                  <span className="text-[11px] text-amber-700 dark:text-amber-400">책임자 공석</span>
                )}
                <span className="tabular-nums text-xs text-zinc-500" title="이 부서 · 하위 포함">
                  {row.memberCount}
                  {row.reachCount !== row.memberCount ? <span className="text-zinc-400"> / {row.reachCount}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {chart.unassignedCount > 0 ? (
        <p className="mt-3 border-t border-zinc-100 pt-3 text-[11px] text-zinc-500 dark:border-zinc-900">
          아직 부서가 정해지지 않은 사람이 {chart.unassignedCount}명이에요. 알림이 부서로 갈 때 이 사람들은 빠져요.
        </p>
      ) : null}
    </section>
  );
}
