/**
 * 아이템(그룹) 프리셋 — 순수 계산부 (BBE-174).
 *
 * ★ 이 파일은 **두 번째 프리셋 정본이 아니다.** 저장 형태·저장소·권한은 전부
 * `./section-presets` 의 것을 그대로 쓴다. 여기 있는 것은 «그룹 한 개» 라는 단위로
 * 그 정본을 부르기 위한 계산뿐이다 — 스냅샷 대상을 고르고, 적용 결과를 미리 재고,
 * 멱등 키를 만든다. I/O 는 한 줄도 없다(그래서 통째로 단위 테스트가 된다).
 *
 * 왜 그룹 단위인가: AGENTS.md §9.3 이 «아이템 = 탭 안의 그룹» 이라고 못박았고
 * 목업 v6 의 프리셋 항목도 탭 메뉴가 아니라 **그룹 메뉴(`gmenu`)** 안에 있다.
 * 반면 기존 `saveSectionPresetAction` 은 `getBoardDetail` 로 보드를 통째로 스냅샷한다.
 * 단위만 좁히고 나머지는 전부 재사용한다.
 *
 * ══ 값 유실 0 의 근거 (수용기준 중 가장 어려운 항목) ══
 *
 * 셀 값은 `item_values.column_key` 로 **컬럼 key 에 매달려** 있다 — 컬럼 «행» 이 아니라
 * «key» 다. 그래서 컬럼을 지우면 그 key 의 값들은 **가리키는 컬럼이 없는 고아**가 된다
 * (구현에 따라 함께 삭제되기도 한다). 어느 쪽이든 사용자에게는 값이 사라진 것으로 보인다.
 *
 * 따라서 프리셋 적용은 **더하기와 재배치만 한다.**
 *
 *   ① 프리셋에만 있는 컬럼   → 보드에 **추가**한다            (added)
 *   ② 양쪽에 다 있는 컬럼    → **손대지 않는다**              (reused)
 *   ③ 보드에만 있는 컬럼    → **지우지 않고** 뒤에 남긴다      (kept)
 *
 * ②가 «덮어쓰기» 가 아니라 «그대로 두기» 인 것이 핵심이다. 같은 key 인데 타입이 다르면
 * 타입을 바꾸는 순간 그 key 에 쌓인 값이 형식을 잃는다. 그래서 타입·선택지·이동규칙을
 * 건드리지 않고 **이름만 미리보기에 보여 준다**(사용자가 차이를 알고 결정하게).
 * ③ 때문에 컬럼 수는 적용 후에 **절대 줄지 않는다** — AGENTS.md §9.3
 * «구조가 줄어든 PR 은 무조건 FAIL» 을 구조적으로 어길 수 없다.
 *
 * 배치는 `board_columns` 가 아니라 그룹별 오버라이드(`boards/groupLayout.ts`)에 저장한다.
 * 오버라이드는 컬럼 key 배열일 뿐이라 컬럼을 만들지도 지우지도 않는다
 * (`components/board/layout.ts` 머리말 참고). 그래서 «기본으로 되돌리기» 는
 * 오버라이드를 비우는 것으로 끝나고, 되돌려도 값은 그대로다.
 */

import type { BoardColumn, BoardGroup } from "@/lib/boards/types";
import {
  SECTION_PRESET_SOURCE,
  snapshotSectionPreset,
  type SectionPresetColumn,
} from "./section-presets";

/**
 * **사용자에게 그대로 보여도 되는** 오류.
 *
 * 서버 액션의 `catch` 는 무엇이 던져졌는지 모른다. 그래서 `error.message` 를 그대로 화면에
 * 띄우면 저장소가 던진 원문이 새어 나간다 — `repo/supabase/boardsRepo.ts` 는 여러 곳에서
 * `throw new Error(q.error.message)` 로 **Supabase 원문**을 던지므로,
 * `duplicate key value violates unique constraint "board_columns_board_id_key_key"` 같은 문장이
 * 사용자에게 보일 수 있다. 행동할 수 없는 안내이고 스키마가 드러난다(§9.2).
 *
 * 그래서 «내가 사용자에게 하려던 말» 만 이 타입으로 던진다. 액션은 이 타입일 때만 문장을
 * 그대로 쓰고, 나머지는 일반 문구로 수렴시킨 뒤 원문은 서버 로그로만 남긴다.
 */
export class PresetActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PresetActionError";
  }
}

/**
 * 프리셋 칩·저장 기본값에 쓰는 이름 — `탭-그룹` 형식(PLAN-002 §5 WO-6 명명 규칙).
 *
 * 화면과 저장이 **같은 함수**를 부르게 해 둔다. 예전에는 `BoardWorkspace` 가 이 문자열을
 * 그 자리에서 조립했고, 그래서 칩에 보이는 이름과 저장되는 이름이 갈라질 수 있었다.
 */
export function groupPresetName(boardName: string, groupName: string): string {
  return `${boardName}-${groupName}`;
}

/**
 * 그룹 하나의 현재 구조를 프리셋 입력으로 만든다.
 *
 * `orderedColumns` 는 **그 그룹에서 실제로 보이는 순서**(`resolveColumnOrder` 의 결과)를
 * 받는다. 보드 기본 순서를 그대로 넘기면 사용자가 그 그룹에서 맞춰 둔 배치가 프리셋에
 * 담기지 않는다 — 저장 버튼이 «지금 보이는 이 구조» 를 뜻하지 않게 된다.
 *
 * 스냅샷 자체는 정본(`snapshotSectionPreset`)에 그대로 위임한다. key/type/source/
 * rightPinned/options/width/move_rule/readOnly 보존은 그쪽이 이미 책임진다.
 */
export function snapshotGroupPreset(
  name: string,
  group: Pick<BoardGroup, "name" | "color">,
  orderedColumns: readonly BoardColumn[],
): ReturnType<typeof snapshotSectionPreset> {
  return snapshotSectionPreset(name, [group as BoardGroup], [...orderedColumns]);
}

/** 적용을 실행하기 전에 사용자에게 보여 줄 «무엇이 어떻게 되는가». */
export interface GroupPresetPreview {
  /** 프리셋에만 있어 보드에 새로 만들어질 컬럼. */
  added: SectionPresetColumn[];
  /**
   * 양쪽에 다 있는 컬럼 — **그대로 둔다.** 타입·선택지가 달라도 덮어쓰지 않는다.
   * `differs` 가 true 면 미리보기에서 그 사실을 알린다(값을 지키기 위한 의도된 무시).
   */
  reused: { key: string; label: string; differs: boolean }[];
  /** 프리셋에 없지만 보드에 있던 컬럼 — **지우지 않고** 배치 뒤쪽에 남는다. */
  kept: BoardColumn[];
  /** 적용 후 이 그룹의 컬럼 배치(오버라이드로 저장할 key 배열). */
  nextOrder: string[];
  /** 적용해도 아무것도 달라지지 않으면 true — 버튼을 눌러도 되는지 판단용. */
  noop: boolean;
}

/**
 * 프리셋을 이 그룹에 적용하면 어떻게 되는지 계산한다. **아무것도 바꾸지 않는다.**
 *
 * 실제 적용 액션은 이 결과를 그대로 실행하므로, 미리보기와 결과가 갈라질 수 없다
 * (같은 함수를 서버가 다시 한 번 부른다 — 화면이 보낸 계산 결과를 믿지 않는다).
 */
export function previewGroupPresetApply(
  presetColumns: readonly SectionPresetColumn[],
  targetColumns: readonly BoardColumn[],
  currentOrder: readonly string[] | undefined,
): GroupPresetPreview {
  const byKey = new Map(targetColumns.map((column) => [column.key, column]));
  const presetKeys = new Set<string>();

  const added: SectionPresetColumn[] = [];
  const reused: GroupPresetPreview["reused"] = [];
  const order: string[] = [];

  for (const column of presetColumns) {
    // 프리셋 안에 같은 key 가 두 번 들어 있어도 배치가 어긋나지 않게 한 번만 센다.
    if (presetKeys.has(column.key)) continue;
    presetKeys.add(column.key);
    order.push(column.key);

    const existing = byKey.get(column.key);
    if (!existing) {
      added.push(column);
      continue;
    }
    reused.push({
      key: column.key,
      label: existing.label,
      differs: columnDiffers(column, existing),
    });
  }

  // ③ 보드에만 있는 컬럼 — 지우지 않고 보드 기본 순서 그대로 뒤에 붙인다.
  const kept: BoardColumn[] = [];
  for (const column of targetColumns) {
    if (presetKeys.has(column.key)) continue;
    kept.push(column);
    order.push(column.key);
  }

  return {
    added,
    reused,
    kept,
    nextOrder: order,
    noop: added.length === 0 && sameOrder(order, resolvedCurrentOrder(currentOrder, targetColumns)),
  };
}

/**
 * 같은 key 인데 구조가 다른가 — 미리보기 경고용이지 «고칠 목록» 이 아니다.
 * 여기서 true 여도 적용은 그 컬럼을 건드리지 않는다(그게 값을 지키는 방식이다).
 */
function columnDiffers(preset: SectionPresetColumn, existing: BoardColumn): boolean {
  if (preset.type !== existing.type) return true;
  if (preset.source !== existing.source) return true;
  if (Boolean(preset.rightPinned) !== Boolean(existing.rightPinned)) return true;
  if (JSON.stringify(preset.move_rule_jsonb ?? null) !== JSON.stringify(existing.move_rule_jsonb ?? null)) return true;
  // 선택지는 «id 의 순서 있는 목록» 으로 견준다. 구분자를 끼워 이으면 id 안에 그 구분자가
  // 들어 있을 때 서로 다른 목록이 같아 보인다 — JSON 배열로 견주면 그 자리가 없다.
  const presetOptions = JSON.stringify((preset.options ?? []).map((option) => option.id));
  const existingOptions = JSON.stringify((existing.options_jsonb?.options ?? []).map((option) => option.id));
  return presetOptions !== existingOptions;
}

/** 오버라이드가 비어 있으면 보드 기본 순서가 곧 현재 순서다. */
function resolvedCurrentOrder(
  currentOrder: readonly string[] | undefined,
  targetColumns: readonly BoardColumn[],
): string[] {
  if (!currentOrder || currentOrder.length === 0) return targetColumns.map((column) => column.key);
  const known = new Set(targetColumns.map((column) => column.key));
  const seen = new Set<string>();
  const order: string[] = [];
  for (const key of currentOrder) {
    if (!known.has(key) || seen.has(key)) continue;
    seen.add(key);
    order.push(key);
  }
  for (const column of targetColumns) if (!seen.has(column.key)) order.push(column.key);
  return order;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

/**
 * 적용을 **실행한 뒤** 저장할 배치.
 *
 * `previewGroupPresetApply().nextOrder` 를 그대로 저장하면 안 된다. `createColumn` 은 key 가
 * 이미 있으면 `_2` 를 붙여 **다른 key 로** 만들기 때문에, 프리셋이 말한 key 가 실제 보드에
 * 없을 수 있다. 그래서 실행부는 «프리셋 순서대로 실제로 확보한 key» 를 모아서 이 함수에
 * 넘기고, 여기서 남은 보드 컬럼을 뒤에 붙인다.
 *
 * 뒤에 붙이는 부분이 «구조 축소 금지» 의 마지막 잠금이다 — 프리셋이 언급하지 않은 컬럼도
 * 반드시 배치에 남는다.
 */
export function appliedColumnOrder(
  resolvedPresetKeys: readonly string[],
  targetColumns: readonly BoardColumn[],
): string[] {
  const order: string[] = [];
  const taken = new Set<string>();
  for (const key of resolvedPresetKeys) {
    if (taken.has(key)) continue;
    taken.add(key);
    order.push(key);
  }
  for (const column of targetColumns) {
    if (taken.has(column.key)) continue;
    taken.add(column.key);
    order.push(column.key);
  }
  return order;
}

/** 이 그룹이 보드 기본 배치에서 벗어나 있는가 — 칩의 «변경됨» 점과 «되돌리기» 노출 조건. */
export function isGroupPresetChanged(order: readonly string[] | undefined): boolean {
  return Boolean(order && order.length > 0);
}

/**
 * 같은 요청을 두 번 보내도 프리셋이 하나만 생기게 하는 저장 키.
 *
 * 기존 `SectionPresetRepo.create` 는 `crypto.randomUUID()` 를 source 에 넣었다 —
 * 새로고침·더블클릭·네트워크 재시도가 그대로 **두 번째 프리셋**이 됐다. 대신 화면이
 * 폼마다 한 번 만든 `requestId` 를 받아 source 를 **결정적으로** 만들고, 저장 직전에
 * 같은 source 가 있는지 본다. 있으면 아무것도 하지 않는다.
 *
 * requestId 만으로 충분하지만 org/board/group 을 섞어 두면 다른 회사·다른 그룹의
 * 요청 id 가 우연히 겹쳐도 서로를 삼키지 않는다.
 */
export function groupPresetRequestSource(
  orgId: string,
  boardId: string,
  groupKey: string,
  requestId: string,
): string {
  const scoped = [orgId, boardId, groupKey, requestId].map(encodeURIComponent).join(":");
  return `${SECTION_PRESET_SOURCE}${scoped}`;
}
