/**
 * 일괄 선택·전화 정규화·CSV 내보내기 — 순수 계산부 (BoardWorkspace 공유 선택 상태의 정본).
 *
 * 화면(체크박스·바·대화상자)과 판정을 분리한다. 판정이 순수 함수라 DOM 없이 검증된다.
 *
 * 선택 범위 계약 (목업 v5 selectedRecs 대응):
 *  - 선택 집합은 BoardWorkspace 1곳에만 산다 (탭·보드 인스턴스별 state).
 *  - 일괄 대상은 «선택 ∩ 현재 보이는 행» 이다. 필터로 숨겨진 행은 절대 수정하지 않는다.
 *  - 존재하지 않는 id 는 prune 으로 털어낸다 (행 삭제·이동 후 잔류 방지).
 */

export const BULK_MAX_ITEMS = 100;

/**
 * 일괄로 직접 쓸 수 없는 불투명 컬럼 — 전이·승인 게이트를 여는 열쇠다.
 * 서버 액션(`bulk-actions.ts`)과 화면이 같은 정본을 쓴다.
 */
export const BULK_BLOCKED_COLUMN_KEYS: ReadonlySet<string> = new Set([
  "contact_move",
  "work_move",
  "seal_status",
  "seal_approval",
]);

/** 어떤 컬럼에 담겨도 전이를 강제하는 값 — 셀에 직접 기입하면 게이트를 우회한다. */
export const BULK_BLOCKED_VALUES: ReadonlySet<string> = new Set([
  "리드컨택으로 넘기기",
  "업무관리 이동",
  "컨택 이동",
]);

/** 일괄 차단 사유 — null 이면 일괄 허용 후보 (서비스 검증은 별도로 돈다). */
export function bulkBlockReasonFor(
  resolvedColumnKey: string,
  value: unknown,
  transitionValue: string | null,
): string | null {
  if (BULK_BLOCKED_COLUMN_KEYS.has(resolvedColumnKey)) {
    return "다음 업무로 넘기는 열은 낱개 확인 흐름에서만 바꿀 수 있습니다";
  }
  if (typeof value === "string" && BULK_BLOCKED_VALUES.has(value)) {
    return "다음 업무로 넘기는 값은 낱개 확인 흐름에서만 바꿀 수 있습니다";
  }
  if (transitionValue !== null && value === transitionValue) {
    return "다음 업무로 넘기는 값은 낱개 확인 흐름에서만 바꿀 수 있습니다";
  }
  return null;
}

/** 전화 표기 차이(+82/하이픈/공백)를 지운 숫자만 남긴다. 82 국가번호는 앞의 0 과 같은 자리다. */
export function normalizeBoardPhoneDigits(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D+/g, "");
  if (digits.startsWith("0082")) return `0${digits.slice(4)}`;
  if (digits.startsWith("82")) return `0${digits.slice(2)}`;
  return digits;
}

export function toggleSelection(current: ReadonlySet<string>, id: string, checked: boolean): Set<string> {
  const next = new Set(current);
  if (checked) next.add(id);
  else next.delete(id);
  return next;
}

/** 그룹 토글 — 그 그룹의 보이는 행 id 전체를 같은 상태로. */
export function toggleGroupSelection(
  current: ReadonlySet<string>,
  visibleGroupIds: readonly string[],
  checked: boolean,
): Set<string> {
  const next = new Set(current);
  for (const id of visibleGroupIds) {
    if (checked) next.add(id);
    else next.delete(id);
  }
  return next;
}

export type TriState = "empty" | "partial" | "full";

/** 마스터·그룹 체크박스 상태. indeterminate = partial. */
export function selectionTriState(
  selected: ReadonlySet<string>,
  visibleIds: readonly string[],
): TriState {
  if (visibleIds.length === 0) return "empty";
  let hit = 0;
  for (const id of visibleIds) if (selected.has(id)) hit += 1;
  if (hit === 0) return "empty";
  return hit === visibleIds.length ? "full" : "partial";
}

/** 일괄 대상 — 선택 ∩ 현재 보이는 행 (순서는 보이는 순서). 존재하지 않는 id 는 제외. */
export function intersectVisibleSelection(
  selected: ReadonlySet<string>,
  visibleIds: readonly string[],
): string[] {
  return visibleIds.filter((id) => selected.has(id));
}

/** 더 이상 존재하지 않는 id 를 선택에서 털어낸다. */
export function pruneSelection(
  selected: ReadonlySet<string>,
  existingIds: ReadonlySet<string>,
): Set<string> {
  const next = new Set<string>();
  for (const id of selected) if (existingIds.has(id)) next.add(id);
  return next;
}

/**
 * 보드·보기 전환 시 선택을 비우는 범위 키 — 보드 id + 저장 보기 활성 여부.
 * 같은 보드 안에서 저장 보기를 켜고 끄면 다른 집합이므로 비운다.
 */
export function selectionScopeKey(boardId: string, savedView: boolean | string): string {
  return `${boardId}::${typeof savedView === "string" ? savedView : savedView ? "saved" : "live"}`;
}

/**
 * Shift-범위 — 현재 보이는 순서(visibleOrderedIds)에서의 anchor→target 구간만.
 * 필터로 숨겨진 행은 ordered에 없으므로 절대 끼지 않는다.
 * anchor가 없거나 순서에 없으면 빈 배열 (낱개 토글로 폴백한다).
 */
export function bulkRangeIds(
  ordered: readonly string[],
  anchor: string | null,
  target: string,
): string[] {
  if (!anchor || anchor === target) return [];
  const from = ordered.indexOf(anchor);
  const to = ordered.indexOf(target);
  if (from < 0 || to < 0) return [];
  const [start, end] = from < to ? [from, to] : [to, from];
  return ordered.slice(start, end + 1);
}

function csvCell(value: unknown): string {
  let text = String(value ?? "");
  // 수식 주입 방지 — Excel 이 수식으로 해석하지 않게 한다 (목업 csvCell 과 동일 계약).
  if (/^[=+\-@]/.test(text.trim())) text = `'${text}`;
  text = text.replace(/"/g, '""');
  return /[",\r\n]/.test(text) ? `"${text}"` : text;
}

/** 선택 행 CSV — 표시 라벨(헤더)과 표시 텍스트(셀)만 담는다. 권한 밖 숨김값은 호출부가 빼고 준다. */
export function selectionToCsv(
  headers: readonly string[],
  lines: readonly (readonly unknown[])[],
): string {
  return [headers, ...lines].map((line) => line.map(csvCell).join(",")).join("\r\n");
}
