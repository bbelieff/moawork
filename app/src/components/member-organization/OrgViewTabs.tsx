"use client";

import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import { membersOfDepartment, ORG_VIEWS, type OrgMemberView, type OrgView, type OrgViewModel } from "@/lib/org/org-view";
import { OrgChartFlow } from "./OrgChartFlow";
import { SeatPanel } from "./SeatPanel";
import { deriveSeats, findSeat, seatName, seatSummary, SEAT_ROLE_LABEL, type Seat } from "@/lib/org/seats";
import type { SeatDefinition } from "@/lib/org/seat-definitions";

/**
 * #640 ①③ — 조직관리의 «보는 방식» 네 갈래와 「부서 ↔ 사람」 잇기.
 *
 * 전에는 부서·사람·권한이 한 페이지에 세로로 쌓여 있었다. 사람이 늘수록 스크롤로 찾아야 했고,
 * 부서를 눌러도 그 부서에 누가 있는지 알 길이 없었다 — 둘이 이어져 있지 않았다.
 *
 * ★ 기존 부품은 «슬롯» 으로 받는다.
 *   Next 16 에서 "use client" 파일이 직접 import 한 것은 전부 클라이언트 번들에 들어간다.
 *   부서 관리·권한표는 props 로 «이미 그려진 결과» 를 받아 그대로 놓는다 — 그러면
 *   서버 컴포넌트로 남고, 구조도 하나도 안 줄어든다(D71~D75).
 */

// 갈래 «목록» 은 서버도 읽어야 해서 lib/org/org-view.ts 가 갖는다. 여기는 이름표만 붙인다.
const VIEW_LABEL: Record<OrgView, string> = {
  seats: "자리",
  list: "목록",
  chart: "조직도 한눈에 보기",
  perm: "권한",
  rules: "알림 규칙",
};

const ROLE_LABEL: Record<string, string> = {
  owner: "대표",
  admin: "관리자",
  team_lead: "팀장",
  member: "구성원",
};

function scopeLabel(member: OrgMemberView): string | null {
  // null = 모른다. 「본인 담당분」으로 떨어뜨리면 가장 좁은 범위라고 «단언» 하는 것이 된다.
  if (member.scope === null) return null;
  if (member.scope === "all") return "회사 전체";
  if (member.scope === "department") {
    return member.primaryDepartmentName ? `${member.primaryDepartmentName} 이하 전체` : "부서 전체";
  }
  return "본인 담당분";
}

/** 모르는 칸은 비워 두지 않고 «모른다» 고 적는다 — 빈칸은 「없음」으로 읽힌다. */
function Unknown(): ReactElement {
  return <span className="text-zinc-400">확인 못 함</span>;
}

function ReportsToCell({ member, known }: { member: OrgMemberView; known: boolean }): ReactElement {
  // ★ 못 읽었으면 이름을 «단언» 하지 않는다. 보고 예외(013)를 못 읽은 상태에서 그린 값은
  //   틀릴 수 있고, 틀린 이름은 빈칸보다 나쁘다.
  if (!known) return <span className="text-zinc-400">확인 못 함</span>;
  if (!member.reportsToName) return <span className="text-zinc-400">— 최상위</span>;
  return (
    <span className="inline-flex items-center gap-1">
      {member.reportsToName}
      {member.isHeadOfPrimary ? <span className="text-[11px] text-zinc-400">(상위)</span> : null}
    </span>
  );
}

function MemberTable({ rows, known }: { rows: OrgMemberView[]; known: boolean }): ReactElement {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-zinc-500">
        이 부서에는 아직 사람이 없어요. 「하위 부서 포함」을 켜면 아래 부서 사람까지 볼 수 있어요.
      </p>
    );
  }
  return (
    // 표는 6열이라 375px 에서 넘친다 — 몸통 대신 이 상자만 밀리게 한다.
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-zinc-100 text-xs text-zinc-500 dark:border-zinc-900">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">이름 · 호칭</th>
            <th scope="col" className="px-3 py-2 font-medium">부서</th>
            <th scope="col" className="px-3 py-2 font-medium">역할</th>
            <th scope="col" className="px-3 py-2 font-medium">보고 대상</th>
            <th scope="col" className="px-3 py-2 font-medium">조회 범위</th>
            <th scope="col" className="px-3 py-2 font-medium">상태</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((member) => (
            <tr key={member.userId} data-user-id={member.userId} className="border-b border-zinc-50 last:border-0 dark:border-zinc-900/60">
              <td className="px-4 py-2.5">
                <div className="font-medium">{member.displayName}</div>
                {/*
                  ★ 「미설정」과 「확인 못 함」은 다른 사실이다 (#644 ③).
                    요약에서 빠진 사람(team_lead·비활성)은 호칭이 없는 게 아니라 못 읽은 것이고,
                    실제로 DB 에는 값이 들어 있을 수 있다. 같은 행의 역할·조회 범위는
                    이미 「확인 못 함」이라 말하는데 호칭만 단언하면 그 줄이 스스로와 어긋난다.
                */}
                <div className="text-[11px] text-zinc-500">
                  {member.titleKnown ? member.title?.trim() || "호칭 미설정" : <Unknown />}
                </div>
              </td>
              <td className="px-3 py-2.5 text-zinc-500">{member.primaryDepartmentName ?? "미배정"}</td>
              <td className="px-3 py-2.5">{member.role === null ? <Unknown /> : ROLE_LABEL[member.role] ?? member.role}</td>
              <td className="px-3 py-2.5"><ReportsToCell member={member} known={known} /></td>
              <td className="px-3 py-2.5 text-zinc-500">{scopeLabel(member) ?? <Unknown />}</td>
              <td className="px-3 py-2.5">
                {member.active ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">활성</span>
                ) : (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">비활성</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OrgViewTabs({
  model,
  initialView = "list",
  departmentSlot,
  permissionSlot,
  seatDefinitions = null,
  canManageSeats = false,
}: {
  model: OrgViewModel;
  /* #683 — 자리 열쇠 → 역할 정의서. null 이면 «못 읽음» 이고 빈 Map 은 «아직 없음» 이다. */
  seatDefinitions?: Map<string, SeatDefinition> | null;
  canManageSeats?: boolean;
  /**
   * 서버가 URL 에서 읽어 넘긴 갈래.
   *
   * ★ 왜 필요한가 — 권한표의 역할 링크는 평범한 <a href="?role=..."> 라서
   *   Next 16 에서 «전체 재적재» 다. 갈래가 클라이언트 state 에만 있으면
   *   권한 갈래에서 「관리자」를 누르는 순간 목록으로 튕긴다. 실제로 그랬다.
   *   그래서 갈래를 URL 에 둔다 — 재적재해도, 링크를 공유해도 그 자리로 돌아온다.
   */
  initialView?: OrgView;
  /** 서버에서 이미 그려진 부서 관리 화면. 「목록」 갈래 아래에 놓인다. */
  departmentSlot: ReactNode;
  /** 서버에서 이미 그려진 권한표·개인별 편집기. 「권한」 갈래가 담는다. */
  permissionSlot: ReactNode;
}): ReactElement {
  const [view, setViewState] = useState<OrgView>(initialView);

  // 갈래를 바꾸면 URL 에도 남긴다. 다른 질의(?role= 등)는 건드리지 않는다.
  const setView = (next: OrgView) => {
    setViewState(next);
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("view", next);
      window.history.replaceState(null, "", url);
    } catch {
      // 주소를 못 고쳐도 화면은 계속 동작해야 한다.
    }
  };
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const [includeSub, setIncludeSub] = useState(true);

  /*
   * #683 — 자리는 «부서 × 역할» 에서 읽는다. 새 엔티티를 만들지 않는다.
   *   공석도 자리다 — 팀장이 비어 있으면 그 사실이 화면에서 사라지면 안 된다.
   */
  const { seats, seatlessMembers } = useMemo(
    () => deriveSeats({ departments: model.departments, members: model.members }),
    [model],
  );
  const seatCounts = useMemo(() => seatSummary(seats, seatlessMembers), [seats, seatlessMembers]);
  const activeSeat = findSeat(seats, selectedSeatId) ?? seats[0] ?? null;

  const selected = model.departments.find((row) => row.id === selectedDeptId) ?? null;
  const rows = useMemo(
    () => membersOfDepartment(model, selectedDeptId, includeSub),
    [model, selectedDeptId, includeSub],
  );
  const headName = selected?.headUserId
    ? model.members.find((member) => member.userId === selected.headUserId)?.displayName ?? null
    : null;

  return (
    <div className="flex flex-col gap-3">
      {/* ① 보는 방식 네 갈래 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/*
          375px 에서 글자가 「권 한」처럼 한 글자씩 접히면 안 된다 —
          접히게 두지 말고, 좁으면 이 줄만 옆으로 밀리게 한다.
        */}
        <div
          role="tablist"
          aria-label="조직관리 보는 방식"
          className="-mx-1 flex max-w-full gap-0.5 overflow-x-auto rounded-lg border border-zinc-200 p-0.5 px-1 dark:border-zinc-800"
        >
          {ORG_VIEWS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              data-view={key}
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition ${
                view === key
                  ? "bg-zinc-900 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {VIEW_LABEL[key]}
            </button>
          ))}
        </div>
        {/*
          ★ 「조직원」은 표에 뜨는 사람 수와 «같은 수» 여야 한다.
            전에 여기만 활성 인원을 세는 바람에 위는 4, 트리와 표는 5 라고 말했다 —
            한 화면 안에서 같은 것을 다르게 세면 둘 중 하나는 반드시 거짓말이다.
            활성 여부는 표의 「상태」 열이 말한다.
        */}
        <span className="text-xs text-zinc-500">
          부서 {model.departments.length} · 조직원 {model.members.length} · 미배정 {model.unassignedCount}
        </span>
      </div>

      {view === "list" ? (
        <div className="flex flex-col gap-4">
          {/* ③ 왼쪽 부서 ↔ 오른쪽 그 부서 사람. 375px 에서는 위아래로 쌓인다. */}
          <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
            <section aria-label="부서" className="rounded-2xl border border-zinc-200 dark:border-zinc-800">
              <div className="border-b border-zinc-100 px-3 py-2.5 text-sm font-semibold dark:border-zinc-900">조직도</div>
              <div className="flex flex-col p-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedDeptId(null)}
                  aria-pressed={selectedDeptId === null}
                  className={`flex items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${
                    selectedDeptId === null ? "bg-zinc-100 font-medium dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  }`}
                >
                  <span aria-hidden="true" className="text-zinc-300">▾</span>
                  <span className="min-w-0 flex-1 truncate">전체</span>
                  <span className="tabular-nums text-xs text-zinc-500">{model.members.length}</span>
                </button>
                {model.departments.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    data-department-id={row.id}
                    onClick={() => setSelectedDeptId(row.id)}
                    aria-pressed={selectedDeptId === row.id}
                    style={{ paddingLeft: `${8 + (row.depth + 1) * 16}px` }}
                    className={`flex items-center gap-2 rounded-lg py-2 pr-2 text-left text-sm ${
                      selectedDeptId === row.id ? "bg-zinc-100 font-medium dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    }`}
                  >
                    <span aria-hidden="true" className="text-zinc-300">·</span>
                    <span className="min-w-0 flex-1 truncate">{row.name}</span>
                    <span className="tabular-nums text-xs text-zinc-500" title="하위 부서 포함 인원">{row.reachCount}</span>
                  </button>
                ))}
                {model.departments.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-zinc-500">아직 부서가 없어요. 아래 「조직도 관리」에서 만들 수 있어요.</p>
                ) : null}
              </div>
            </section>

            <section aria-label="조직원" className="min-w-0 rounded-2xl border border-zinc-200 dark:border-zinc-800">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-900">
                <h3 className="text-sm font-semibold">{selected ? selected.name : "전체"}</h3>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-zinc-500">
                    {rows.length}명{selected ? ` · 책임자 ${headName ?? "공석"}` : ""}
                  </span>
                  {selected ? (
                    <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                      <input
                        type="checkbox"
                        checked={includeSub}
                        onChange={(event) => setIncludeSub(event.target.checked)}
                        className="h-3.5 w-3.5 accent-zinc-900 dark:accent-zinc-100"
                      />
                      하위 부서 포함
                    </label>
                  ) : null}
                </div>
              </div>

              {selected ? (
                <div className="border-b border-zinc-100 px-4 py-2 text-[11px] text-zinc-500 dark:border-zinc-900">
                  대상 키 <code className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">dept:{selected.id}</code>
                  {" · "}이 부서를 대상으로 지정하면 하위 부서까지 포함해서 전달돼요
                  {headName ? null : (
                    <b className="ml-1 text-amber-700 dark:text-amber-400">· 책임자 공석 — 보고가 상위로 넘어가요</b>
                  )}
                </div>
              ) : null}

              {!model.reportingKnown ? (
                <p role="status" className="border-b border-zinc-100 px-4 py-2 text-[11px] text-amber-700 dark:border-zinc-900 dark:text-amber-400">
                  보고 예외 지정을 읽지 못해서 「보고 대상」을 확인할 수 없어요. 부서가 없는 것과는 다른 상태예요.
                </p>
              ) : null}

              <MemberTable rows={rows} known={model.reportingKnown} />
            </section>
          </div>

          {/* 구조를 줄이지 않는다 — 기존 부서 관리는 그대로 이 갈래 안에 남는다. */}
          {departmentSlot}
        </div>
      ) : null}

      {view === "seats" ? (
        /*
          #683 · D안 — 부분과 전체를 «이름표로» 가른다.
          왼쪽은 회사 전체, 오른쪽은 고른 자리 하나. 둘 다 늘 보인다.
        */
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <section aria-label="전체" className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <div
              data-region="all"
              className="flex items-center gap-2 bg-sky-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
            >
              전체 — 우리 회사
              <span className="ml-auto font-normal normal-case tracking-normal">
                자리 {seatCounts.seatCount} · 사람 {seatCounts.peopleCount} · 공석 {seatCounts.vacantCount}
                {/* 「자리」 단위임을 붙여 둔다 — 아래 구역의 「…N명」과 단위가 달라 나란히 두면 헷갈린다. */}
                {seatCounts.unknownCount > 0 ? ` · 확인 못 한 자리 ${seatCounts.unknownCount}` : ""}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 p-1.5">
              {seats.map((seat: Seat) => (
                <button
                  key={seat.id}
                  type="button"
                  data-seat-id={seat.id}
                  aria-pressed={activeSeat?.id === seat.id}
                  onClick={() => setSelectedSeatId(seat.id)}
                  className={`flex items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${
                    activeSeat?.id === seat.id
                      ? "bg-indigo-50 font-medium dark:bg-indigo-950/40"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{seatName(seat)}</span>
                  {seat.status === "unknown" ? (
                    // ★ 이 부서에 역할을 못 읽은 사람이 있다. 그 사람이 이 자리의 주인일 수 있으므로
                    //   «비었다» 고 단언하지 않는다. 붉은색도 쓰지 않는다 — 붉은색은 «확인된 공석» 의 색이다.
                    <span data-seat-unknown className="shrink-0 text-xs font-semibold text-amber-700 dark:text-amber-400">
                      확인 못 함
                    </span>
                  ) : seat.status === "vacant" ? (
                    <span data-seat-vacant className="shrink-0 text-xs font-semibold text-red-700 dark:text-red-400">공석</span>
                  ) : (
                    <span className="shrink-0 truncate text-xs text-zinc-500">
                      {seat.occupants[0]?.displayName}
                      {seat.occupants.length > 1 ? ` 외 ${seat.occupants.length - 1}` : ""}
                    </span>
                  )}
                </button>
              ))}
              {seats.length === 0 ? (
                <p className="px-2 py-6 text-sm text-zinc-500">
                  아직 부서와 사람이 없어요. 부서를 만들면 자리가 생겨요.
                </p>
              ) : null}

              {/*
                ★ 역할을 못 읽은 사람도 «여기 있는 사람» 이다.
                  자리를 못 만든다고 목록에서 빼면 그 사람은 조직관리에서 통째로 사라진다 —
                  이 화면이 「우리 회사 전체」라고 이름 붙인 이상 그건 거짓말이 된다.
                  자리를 «단언» 하지 않으면서 사람은 보이게 하는 자리가 여기다.
              */}
              {seatlessMembers.length > 0 ? (
                <div data-seatless-region className="mt-1.5 border-t border-zinc-200 pt-1.5 dark:border-zinc-800">
                  <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    자리를 못 정한 사람 {seatlessMembers.length}명
                  </p>
                  <p className="px-2 pb-1.5 text-xs text-zinc-500">
                    자리는 못 정했지만 빠진 사람은 아니에요.
                  </p>
                  {seatlessMembers.map((member) => (
                    <div
                      key={member.userId}
                      data-seatless-member={member.userId}
                      data-seatless-active={member.active ? "yes" : "no"}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">{member.displayName}</span>
                      {/*
                        ★ «왜 자리가 없는지» 를 아는 만큼만 말한다.
                          비활성인 사람은 이유를 «안다» — 그걸 「역할을 읽지 못했어요」라고 하면
                          그것도 틀린 단언이다. 이 PR 이 잡으려던 병과 같은 종류다, 방향만 반대다.
                      */}
                      <span
                        className={`shrink-0 text-xs ${
                          member.active ? "text-amber-700 dark:text-amber-400" : "text-zinc-500"
                        }`}
                      >
                        {member.active ? "역할 확인 못 함" : "비활성"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          {activeSeat ? (
            <SeatPanel
              seat={activeSeat}
              definition={seatDefinitions?.get(activeSeat.id) ?? null}
              definitionKnown={seatDefinitions !== null}
              canManage={canManageSeats}
            />
          ) : null}
        </div>
      ) : null}

      {view === "chart" ? <OrgChartFlow model={model} /> : null}

      {view === "perm" ? <div className="flex flex-col gap-4">{permissionSlot}</div> : null}

      {view === "rules" ? (
        <div className="rounded-2xl border border-zinc-200 p-8 text-center dark:border-zinc-800">
          <p className="font-medium">알림 규칙은 아직 없어요</p>
          {/*
            ★ 여기서 한 번 거짓말을 했다 — 「지금은 보고 계통을 따라 알림이 갑니다」라고 적었는데
              그 경로(lib/org/notification-routing.ts)를 쓰는 곳이 0개다. 실제로 도는
              CurrentMainRoutingPort(lib/notify/server.ts)는 담당자와 팀만 보고 보고 계통은 안 본다.
              «아직 없다» 고 말하려면 «지금 무엇이 되는지» 도 사실이어야 한다.
          */}
          <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">
            어떤 일이 생겼을 때 누구에게 알릴지 정하는 자리예요. 지금 알림은 담당자와 팀에게만 가고,
            <b> 「목록」의 보고 대상은 아직 알림에 쓰이지 않아요.</b>
          </p>
        </div>
      ) : null}
    </div>
  );
}
