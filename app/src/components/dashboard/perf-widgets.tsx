// T07 · mod.perf 대시보드 위젯(프레젠테이션 전용).
//
// 순수 렌더 — 데이터 조회 없음(상위 Server Component 가 buildPerf 로 주입).
// 모든 위젯은 0건/미가용 상태에서 '—' 또는 0 을 표시한다(NaN·빈화면 금지, 게이트 요건).
//
// 표시 포맷터·컨테이너는 T04 core.dash 것을 재사용한다 — 대시보드 안에서 카드 테두리·
// 숫자 표기가 위젯마다 달라지면 안 되므로 별도 정의하지 않는다.

import type { ReactNode } from "react";
import { EMPTY, formatCount, formatKrw, formatMonth } from "@/lib/dash/format";
import { Widget } from "@/components/dash/widgets";
import type {
  ContractCompanyEntry,
  Leaderboard,
  LeaderboardRow,
  LeaderboardSort,
  MonthlyContractCompanies,
} from "@/lib/perf/types";

/** 정렬 기준 라벨 — 헤더 강조에 쓴다. */
const SORT_LABEL: Record<LeaderboardSort, string> = {
  fee: "수수료합",
  exec: "실행액",
  deals: "수납건수",
};

/** 순위 표시 — 1~3위는 메달, 그 외는 숫자. 순위 밖(미배정)은 '—'. */
export function rankLabel(rank: number | null): string {
  if (rank === null) return EMPTY;
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return String(rank);
}

function Th({
  children,
  numeric = false,
  active = false,
}: {
  children: ReactNode;
  numeric?: boolean;
  active?: boolean;
}) {
  return (
    <th
      scope="col"
      className={[
        "px-2 py-1.5 text-xs font-medium",
        numeric ? "text-right" : "text-left",
        active ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-500",
      ].join(" ")}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  numeric = false,
}: {
  children: ReactNode;
  numeric?: boolean;
}) {
  return (
    <td
      className={[
        "px-2 py-1.5 text-sm",
        numeric ? "text-right tabular-nums" : "text-left",
      ].join(" ")}
    >
      {children}
    </td>
  );
}

function LeaderboardTr({
  row,
  highlight,
}: {
  row: LeaderboardRow;
  highlight: boolean;
}) {
  return (
    <tr
      className={[
        "border-t border-zinc-100 dark:border-zinc-800",
        highlight ? "bg-amber-50 dark:bg-amber-950/30" : "",
        // 미배정 버킷은 순위 밖 참고 행이므로 흐리게.
        row.rank === null ? "text-zinc-500" : "",
      ].join(" ")}
    >
      <Td>
        <span aria-hidden="true">{rankLabel(row.rank)}</span>
        <span className="sr-only">
          {row.rank === null ? "순위 없음" : `${row.rank}위`}
        </span>
      </Td>
      <Td>{row.name}</Td>
      <Td numeric>{formatCount(row.dealCount)}</Td>
      <Td numeric>{formatKrw(row.execSum)}</Td>
      <Td numeric>{formatKrw(row.feeSum)}</Td>
    </tr>
  );
}

/**
 * KPI 리더보드 — 담당자별 수납건수 / 실행액 / 수수료합.
 *
 * ⚠ 라벨 주의: 여기의 "수납"은 `fee_paid_at`(수수료 입금) 기준 **실현** 지표다.
 *   파이프라인의 "계약단계 도달"(T04 conversionRate)과 다른 수치이므로 섞어 쓰지 않는다.
 *
 * @param currentUserId 본인 행 하이라이트용(없으면 하이라이트 없음).
 */
export function LeaderboardWidget({
  data,
  currentUserId = null,
}: {
  data: Leaderboard;
  currentUserId?: string | null;
}) {
  const { rows, unassigned, totals } = data;
  const empty = rows.length === 0 && unassigned === null;

  return (
    <Widget
      title="KPI 리더보드"
      subtitle={`${formatMonth(data.period)} · 수납(수수료 입금일) 기준 · ${SORT_LABEL[data.sort]} 순`}
    >
      {empty ? (
        <p className="py-6 text-center text-sm text-zinc-400">
          이달 수납 실적이 없습니다 {EMPTY}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse">
            <thead>
              <tr>
                <Th>순위</Th>
                <Th>담당자</Th>
                <Th numeric active={data.sort === "deals"}>
                  수납건수
                </Th>
                <Th numeric active={data.sort === "exec"}>
                  실행액
                </Th>
                <Th numeric active={data.sort === "fee"}>
                  수수료합
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <LeaderboardTr
                  key={row.userId ?? "unassigned"}
                  row={row}
                  highlight={currentUserId !== null && row.userId === currentUserId}
                />
              ))}
              {unassigned ? (
                <LeaderboardTr row={unassigned} highlight={false} />
              ) : null}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-zinc-200 font-medium dark:border-zinc-700">
                <Td>{null}</Td>
                <Td>합계</Td>
                <Td numeric>{formatCount(totals.dealCount)}</Td>
                <Td numeric>{formatKrw(totals.execSum)}</Td>
                <Td numeric>{formatKrw(totals.feeSum)}</Td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Widget>
  );
}

function CompanyRow({ entry, top }: { entry: ContractCompanyEntry; top: boolean }) {
  return (
    <li
      className={[
        "flex items-baseline justify-between gap-3 border-t border-zinc-100 py-1.5 first:border-t-0 dark:border-zinc-800",
        top ? "font-medium" : "",
      ].join(" ")}
    >
      <span className="truncate">
        {top ? <span aria-hidden="true">🏆 </span> : null}
        {entry.name}
      </span>
      <span className="shrink-0 tabular-nums text-zinc-600 dark:text-zinc-300">
        {formatKrw(entry.feeSum)}
        <span className="ml-2 text-xs text-zinc-400">
          {formatCount(entry.dealCount)}건
        </span>
      </span>
    </li>
  );
}

/**
 * 이달의 계약회사 — `fee_paid_at` 이 이번 달인 정산을 고객사별로 묶어 수수료 순으로 보여준다.
 * 1위(top)를 크게 강조하고 나머지는 목록으로 잇는다.
 *
 * @param limit 목록 최대 표시 수(기본 5). 초과분은 '외 N곳' 으로 요약한다.
 */
export function MonthlyContractCompanyWidget({
  data,
  limit = 5,
}: {
  data: MonthlyContractCompanies;
  limit?: number;
}) {
  const shown = data.entries.slice(0, limit);
  const restCount = data.entries.length - shown.length;

  return (
    <Widget
      title="이달의 계약회사"
      subtitle={`${formatMonth(data.period)} · 수수료 입금일 기준`}
    >
      {!data.available || !data.top ? (
        <p className="py-6 text-center text-sm text-zinc-400">
          이달 수납된 계약이 없습니다 {EMPTY}
        </p>
      ) : (
        <>
          <div className="mb-3">
            <div className="truncate text-xl font-semibold">
              <span aria-hidden="true">🏆 </span>
              {data.top.name}
            </div>
            <div className="mt-0.5 text-sm text-zinc-500 tabular-nums">
              수수료 {formatKrw(data.top.feeSum)} · 실행액{" "}
              {formatKrw(data.top.execSum)} · {formatCount(data.top.dealCount)}건
            </div>
          </div>
          <ul>
            {shown.map((e) => (
              <CompanyRow
                key={e.companyId ?? "none"}
                entry={e}
                top={e === data.top}
              />
            ))}
          </ul>
          {restCount > 0 ? (
            <p className="mt-2 text-xs text-zinc-400">외 {restCount}곳</p>
          ) : null}
        </>
      )}
    </Widget>
  );
}
