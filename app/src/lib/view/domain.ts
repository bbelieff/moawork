/**
 * 뷰 적용 도메인 로직 (BBE-117). 순수 함수만 — I/O 없음.
 *
 * D24 — 조회 범위가 뷰보다 먼저 적용된다. 뷰는 권한이 아니다.
 *   `applyView`는 **이미 조회 범위로 걸러진 행**(scopedRows)만 받는다. 걸러지지 않은 원본
 *   행을 받는 시그니처를 아예 두지 않음으로써 "뷰가 범위를 우회"하는 경로를 구조적으로 막는다.
 *   범위 자체(누가 무엇을 볼 수 있나)는 이 모듈의 몫이 아니다 — 호출부(레코드 조회 계층·lib/perm)가
 *   scopedRows를 만들어 넘긴다.
 *
 * D26 — «내 담당»/«내 팀 담당»은 저장된 사람이 아니라 **지금 보는 사람** 기준이다.
 *   personScope="viewer"|"team" 인 뷰는 ctx.currentUserId/teamMemberIds로 매 호출마다 계산한다.
 *   personScope="fixed"만 저장된 person_scope_user_id를 쓴다(예: 먼데이에서 가져온 고정 뷰).
 */

import type { PersonScope, ResolvedView, TabView, ViewFilterMap, ViewSort } from "./contracts";
import { isSystemView } from "./contracts";

export interface ViewApplyContext<T> {
  /** 지금 보고 있는 사람. personScope="viewer" 판정 기준(D26). */
  readonly currentUserId: string;
  /** 지금 보는 사람의 팀(부서 이하) 구성원 id 목록. personScope="team" 판정 기준.
   *  조직도 계산은 lib/org 소관 — 이 모듈은 계산된 결과만 받는다. */
  readonly teamMemberIds: readonly string[];
  /** 행에서 담당자(소유자) 값을 뽑는다. 컬럼명이 탭마다 다를 수 있어 호출부가 매핑을 안다. */
  readonly ownerOf: (row: T) => string | null;
  /** 행에서 필터·정렬 대상 컬럼 값을 문자열로 뽑는다. */
  readonly cellOf: (row: T, columnKey: string) => string | null;
  /** 행의 고유 id. 선택 발송 대상(D63) 산출에 쓰인다. */
  readonly idOf: (row: T) => string;
}

function matchesPersonScope<T>(row: T, view: TabView, ctx: ViewApplyContext<T>): boolean {
  const scope: PersonScope = view.personScope;
  if (scope === "none") return true;
  const owner = ctx.ownerOf(row);
  if (scope === "viewer") return owner === ctx.currentUserId;
  if (scope === "team") return owner !== null && ctx.teamMemberIds.includes(owner);
  // fixed
  return owner === view.personScopeUserId;
}

function matchesFilters<T>(row: T, filters: ViewFilterMap, cellOf: ViewApplyContext<T>["cellOf"]): boolean {
  for (const [columnKey, values] of Object.entries(filters)) {
    if (!values.length) continue;
    const cell = cellOf(row, columnKey);
    if (cell === null || !values.includes(cell)) return false;
  }
  return true;
}

function applySort<T>(rows: readonly T[], sort: readonly ViewSort[], cellOf: ViewApplyContext<T>["cellOf"]): T[] {
  if (!sort.length) return [...rows];
  return rows
    .map((row, idx) => ({ row, idx }))
    .sort((a, b) => {
      for (const s of sort) {
        const av = cellOf(a.row, s.columnKey) ?? "";
        const bv = cellOf(b.row, s.columnKey) ?? "";
        if (av === bv) continue;
        const cmp = av < bv ? -1 : 1;
        return s.direction === "asc" ? cmp : -cmp;
      }
      return a.idx - b.idx; // 안정 정렬
    })
    .map((x) => x.row);
}

/**
 * 뷰를 이미-범위필터된 행에 적용한다(필터 → 사람조건 → 정렬).
 * 시스템 뷰(보드/표/캘린더, 저장 안 됨)는 조건이 없어 scopedRows를 그대로(정렬 없이) 반환한다.
 */
export function applyView<T>(scopedRows: readonly T[], view: ResolvedView, ctx: ViewApplyContext<T>): T[] {
  if (isSystemView(view)) return [...scopedRows];
  const filtered = scopedRows.filter(
    (row) => matchesPersonScope(row, view, ctx) && matchesFilters(row, view.filters, ctx.cellOf),
  );
  return applySort(filtered, view.sort, ctx.cellOf);
}

/**
 * 「선택 N건 발송」(D63, 260810 개정 ⑧)의 대상 id 목록.
 * 뷰가 활성 상태에서 발송을 누르면 이 함수가 반환한 id들이 곧 발송 대상이다 —
 * 별도 "대상 고르기" 단계가 없다. BBE-118(필터)·BBE-114(솔라피)는 이 함수의 출력을 그대로 쓴다.
 */
export function selectionTargetIds<T>(rows: readonly T[], idOf: ViewApplyContext<T>["idOf"]): string[] {
  return rows.map(idOf);
}

/**
 * 조회 범위 때문에 숨겨진 건수(mockup의 「권한 밖 N건 숨김」).
 * 원본 행을 이 모듈에 넘기지 않기 위해, 호출부가 이미 두 개의 카운트를 따로 계산해 넘긴다:
 *   - totalMatchCount: 범위를 무시하고 이 뷰의 필터·사람조건에 맞는 조직 전체 건수
 *   - scopedMatchCount: applyView() 결과 건수(= 지금 보이는 건수)
 * 이 함수는 그 차이만 계산한다 — 실제 미노출 행 데이터는 여기 들어오지 않는다.
 */
export function hiddenByScopeCount(totalMatchCount: number, scopedMatchCount: number): number {
  return Math.max(0, totalMatchCount - scopedMatchCount);
}

/** 공용 뷰 / 나만 보기 분리(D25). 나만 뷰는 본인 소유만 남긴다(다른 사람 개인뷰는 RLS로 애초에 안 옴). */
export function splitByVisibility(
  views: readonly TabView[],
  currentUserId: string,
): { shared: TabView[]; private: TabView[] } {
  return {
    shared: views.filter((v) => v.visibility === "shared"),
    private: views.filter((v) => v.visibility === "private" && v.ownerId === currentUserId),
  };
}

/** 뷰 이름 옆에 붙는 「나」/「내 팀」 배지(D26) — 결과가 보는 사람마다 다르다는 표시. */
export function dynamicBadge(view: ResolvedView): "나" | "내 팀" | null {
  if (isSystemView(view)) return null;
  if (view.personScope === "viewer") return "나";
  if (view.personScope === "team") return "내 팀";
  return null;
}

/** 기본 화면 = 시스템 «보드» 뷰(mockup setView 초기값과 동일). */
export const DEFAULT_SYSTEM_VIEW: ResolvedView = { system: true, kind: "board", name: "보드" };
