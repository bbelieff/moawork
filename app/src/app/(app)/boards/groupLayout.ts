/**
 * 그룹별 컬럼 배치 오버라이드 저장소 (PLAN-002 WO-2 ⓑ).
 *
 * 저장하는 것은 **배치뿐**이다 — 컬럼 정의도, 셀 값도 여기 없다. 그래서 이 저장소가
 * 통째로 비어도 화면은 보드 기본 순서로 정상 렌더된다(원상복구 = 오버라이드 삭제).
 * 판정 규칙은 `@/components/board/layout` 의 `resolveColumnOrder` 가 단독으로 갖는다.
 *
 * 보관 방식은 `lib/repo/local/*` 의 로컬 어댑터와 같은 **서버 인메모리(globalThis)** 다.
 * Supabase 연결 시에는 이 파일의 두 함수만 board_views.visible_columns_jsonb 로 갈아끼우면
 * 되도록 읽기/쓰기 표면을 2개로 좁혀 두었다.
 *
 * ⚠ 인증·인가는 여기서 하지 않는다. 호출부(서버 액션)가 `getBoardDetail` 로 보드 접근
 * 권한을 먼저 확인하고, 통과한 뒤에만 이 저장소를 만진다. 그래서 키에 orgId 를 포함해
 * 조직이 달라지면 배치도 섞이지 않게 한다.
 */

import type { GroupColumnOrder } from "@/components/board/layout";

type Store = Map<string, string[]>;

const g = globalThis as unknown as { __moaworkGroupLayout?: Store };

function store(): Store {
  g.__moaworkGroupLayout ??= new Map();
  return g.__moaworkGroupLayout;
}

/**
 * 키 구분자. groupKey 에는 board_groups.id(UUID)나 예약어(`__ungrouped__`)만 들어가고
 * 둘 다 이 문자를 포함하지 않으므로, 구분자가 값에 섞여 경계가 흐려질 일이 없다.
 */
const SEP = "/";

function cellKey(orgId: string, boardId: string, groupKey: string): string {
  return `${orgId}${SEP}${boardId}${SEP}${groupKey}`;
}

function boardPrefix(orgId: string, boardId: string): string {
  return `${orgId}${SEP}${boardId}${SEP}`;
}

/** 보드 한 장의 전체 오버라이드(그룹 키 → 컬럼 key 배열). 없으면 빈 객체. */
export function getBoardColumnOrder(orgId: string, boardId: string): GroupColumnOrder {
  const prefix = boardPrefix(orgId, boardId);
  const out: GroupColumnOrder = {};
  for (const [k, v] of store()) {
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = [...v];
  }
  return out;
}

/**
 * 그룹 하나의 배치를 저장한다. 빈 배열을 주면 오버라이드를 **지운다**
 * (= 그 그룹만 보드 기본 순서로 되돌리기).
 */
export function setGroupColumnOrder(
  orgId: string,
  boardId: string,
  groupKey: string,
  columnKeys: readonly string[],
): void {
  const key = cellKey(orgId, boardId, groupKey);
  if (columnKeys.length === 0) store().delete(key);
  else store().set(key, [...columnKeys]);
}
