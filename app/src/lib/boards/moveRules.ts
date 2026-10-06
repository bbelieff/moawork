/**
 * 아이템 자동 이동 규칙 (D68~D70) — 값이 바뀌면 아이템이 그룹을 옮겨간다.
 *
 * 목업 실측(dump-mockup.mjs new): "상담 상황" 이 «상담 전»이면 💡신규고객,
 * «거절»이면 🚫거절 그룹으로 — 같은 매커니즘이 리드컨택·계약업체 실무의
 * "다음으로 넘기는 조작 열"(D69, 우측 고정)에도 그대로 쓰인다.
 * 규칙은 특정 컬럼명에 하드코딩하지 않는다 — 어느 select 컬럼이든
 * `move_rule_jsonb`(선택지 id → 목표 group id)를 가지면 이 컬럼이 곧 "조작 열"이다.
 *
 * 순수 함수만 담는다(도메인 규칙과 저장 부수효과를 분리 — service.ts 가 조합).
 */

import type { FieldOption } from "@/lib/types";
import type { BoardColumn, CellValue } from "./types";

/**
 * 컬럼의 이동 규칙과 새 값으로 목표 그룹을 정한다.
 * - 규칙이 없는 컬럼(일반 컬럼) → null(이동 안 함)
 * - 값이 선택지 배열(multiselect)이면 이동 규칙 대상이 아니다 → null
 *   (여러 그룹을 동시에 가리킬 수 없다 — "다음 단계"는 단일 목적지여야 한다)
 * - 값이 규칙에 없는 선택지(또는 빈 값)면 → null(그 값은 이동을 유발하지 않음)
 */
export function resolveMoveTarget(
  column: Pick<BoardColumn, "move_rule_jsonb">,
  newValue: CellValue,
): string | null {
  const rule = column.move_rule_jsonb;
  if (!rule) return null;
  if (Array.isArray(newValue)) return null;
  if (newValue === null || newValue === undefined) return null;
  const key = String(newValue);
  return rule[key] ?? null;
}

/** 이 컬럼이 "조작 열"(이동 규칙을 가진 컬럼)인가 — UI/서비스가 분기용으로 쓴다. */
export function isMoveColumn(column: Pick<BoardColumn, "move_rule_jsonb">): boolean {
  return Boolean(column.move_rule_jsonb && Object.keys(column.move_rule_jsonb).length > 0);
}

/**
 * 그룹 이름의 «앞머리 장식» 만 벗긴 본문 — 「같은 그룹인가」 판정용 열쇠.
 *
 * 2026-10-06 — 회사가 «🔂 심사 중» 을 «심사 중» 으로 고쳐 쓰면 설치기가 정확한 이름만 보고
 * 「없다」 고 판정해 빈 «🔂 심사 중» 을 또 만들었다(운영 실측: 빈 복제 그룹 9개).
 * 그림 기호·변형 선택자(U+FE0E/FE0F)·ZWJ·피부색 수정자·공백만 벗긴다.
 * **숫자는 지킨다** — «1차 부재» 와 «2차 부재» 는 다른 그룹이다(옛 `^\P{L}+` 는 둘을 같게 봤다).
 * 본문이 다르면 다른 그룹이다(추측으로 합치지 않는다).
 */
export function plainGroupName(name: string): string {
  return name
    .normalize("NFC")
    .replace(/^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[︎️‍]|\s)+/u, "")
    .trim();
}

type StageColumn = Pick<BoardColumn, "type" | "move_rule_jsonb" | "options_jsonb">;
type StageGroup = Readonly<{ id: string; name: string }>;

/**
 * 그룹 → 대표 단계(primary option) — 이동 규칙을 거꾸로 읽는다.
 *
 * - 규칙이 그 그룹을 가리키는 «살아 있는» 선택지(보관 안 됨)가 하나면 그것이 대표다.
 * - 여럿이면, 앞머리 장식을 벗긴 라벨이 그룹 이름과 같은 «하나» 가 대표다
 *   (예: 소공인(상생)·관리중 → 관리중 그룹이면 «관리중»). 그것도 없거나 여럿이면 모호하다 → null.
 * - 단일 목적지 컬럼(select/status)만 대상이다. multiselect·person·people 는 null.
 *
 * 1:1 전단사를 요구하지 않는다 — 한 그룹에 여러 선택지가 가도 «대표» 하나만 정해지면 된다.
 */
export function primaryStageForGroup(
  column: StageColumn,
  groups: readonly StageGroup[],
  groupId: string | null,
): string | null {
  if (groupId === null) return null;
  if (column.type !== "select" && column.type !== "status") return null;
  const rule = column.move_rule_jsonb;
  if (!rule) return null;
  const candidates = (column.options_jsonb?.options ?? [])
    .filter((option) => option.archived !== true && rule[option.id] === groupId);
  if (candidates.length === 1) return candidates[0].id;
  if (candidates.length === 0) return null;
  const group = groups.find((candidate) => candidate.id === groupId);
  if (!group) return null;
  // #845 동기화 뒤에는 대표의 라벨이 그룹 이름과 «정확히» 같다 — 그것을 먼저 본다.
  const exact = candidates.filter((option) => option.label === group.name);
  if (exact.length === 1) return exact[0].id;
  const groupKey = plainGroupName(group.name);
  const named = candidates.filter((option) => plainGroupName(option.label) === groupKey);
  return named.length === 1 ? named[0].id : null;
}

/**
 * 행이 다른 그룹으로 «옮겨질 때» 단계 칸에 쓸 값 — 없으면 null(값은 그대로 두고 위치만 옮긴다).
 *
 * 결정적이어야 한다: 같은 requestId 로 다시 보낸 이동(응답 유실 뒤 재시도)이 «같은 내용» 을
 * 다시 만들어야 receipt 가 재생된다(값이 섞인 이동과 값 없는 이동은 서로 다른 요청이라
 * 바뀌면 «replay conflict» 가 난다). 그래서 «지금 상태» 만 보고 판단하되, 커밋 뒤 상태에서도
 * 같은 답이 나오게 짠다:
 *   1. 대표 단계 D 가 없거나(규칙 없음·모호) 칸을 손으로 못 고치면 → null.
 *   2. 현재 값이 이미 D 면 → D (같은 값 재기록 — 커밋 뒤 재시도도 D 라서 같은 요청이 된다).
 *   3. 같은 그룹 안 순서 바꾸기면 → null (값만 있는 단계를 덮어쓰지 않는다).
 *   4. 현재 값의 규칙이 이미 목적 그룹을 가리키면 → null (회사가 고른 단계를 지킨다).
 *   5. 그 밖에는 → D.
 */
export function planStageBackSync(input: Readonly<{
  column: StageColumn & Partial<Pick<BoardColumn, "is_readonly" | "archived_at">>;
  editable: boolean;
  groups: readonly StageGroup[];
  currentValue: CellValue | undefined;
  sourceGroupId: string | null;
  targetGroupId: string | null;
}>): string | null {
  const { column } = input;
  if (!input.editable || column.is_readonly || column.archived_at) return null;
  const primary = primaryStageForGroup(column, input.groups, input.targetGroupId);
  if (primary === null) return null;
  const current = typeof input.currentValue === "string" ? input.currentValue : null;
  if (current === primary) return primary;
  if (input.sourceGroupId === input.targetGroupId) return null;
  if (current !== null && resolveMoveTarget(column, current) === input.targetGroupId) return null;
  return primary;
}

/** 그룹에 대표 단계가 없을 때 새로 만드는 선택지 id — 그룹 id 에서 나오므로 다시 계산해도 같다. */
export function stageOptionIdForGroup(groupId: string): string {
  return `group:${groupId}`;
}

export type StageSyncGroup = Readonly<{ id: string; name: string; sort_order: number; color?: string | null }>;

export type StageSyncSettings = Readonly<{
  /**
   * 설치기가 만드는 그룹 이름(정의 이름 그대로). 빈 설치기 복제는 이 이름과 «정확히» 같을 때만
   * 복제로 본다 — 회사가 손으로 만든 같은 본문 이름의 그룹은 복제가 아니다. 없으면 이름으로 거르지 않는다.
   */
  installerGroupNames?: ReadonlySet<string>;
}>;

export type StageSyncPlan = Readonly<{
  options: FieldOption[];
  moveRule: Record<string, string>;
  /** 저장된 선택지·규칙과 다른가 — false 면 쓰지 않는다(두 번째 동기화는 쓰기 0). */
  changed: boolean;
}>;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sortGroups(groups: readonly StageSyncGroup[]): StageSyncGroup[] {
  return [...groups].sort((left, right) =>
    left.sort_order - right.sort_order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

/**
 * 정렬된 그룹 중 «앞선 같은 본문 이름의 그룹이 있는» 그룹 → 그 맨 앞 그룹(원래 그룹).
 * 빈 설치기 복제의 후보다. 설치기 이름 그대로인 그룹만 후보다(`installerGroupNames` 가 있으면).
 */
function duplicateCandidates(
  sorted: readonly StageSyncGroup[],
  settings: StageSyncSettings,
): Map<string, StageSyncGroup> {
  const firstByName = new Map<string, StageSyncGroup>();
  const keeperOf = new Map<string, StageSyncGroup>();
  for (const group of sorted) {
    const key = plainGroupName(group.name);
    const first = firstByName.get(key);
    if (!first) {
      firstByName.set(key, group);
      continue;
    }
    if (!settings.installerGroupNames || settings.installerGroupNames.has(group.name)) keeperOf.set(group.id, first);
  }
  return keeperOf;
}

/** 같은 본문 이름의 «다른» 그룹을 규칙이 가리키는가. */
function sameNameGroupLinked(
  group: StageSyncGroup,
  sorted: readonly StageSyncGroup[],
  rule: Readonly<Record<string, string>>,
): boolean {
  const key = plainGroupName(group.name);
  const targets = new Set(Object.values(rule));
  return sorted.some((other) => other.id !== group.id && targets.has(other.id) && plainGroupName(other.name) === key);
}

/**
 * 동기화가 «빈 설치기 복제» 를 가리려면 행 수가 필요한가 — 복제 후보가 하나라도 있을 때만 그렇다.
 * 없으면 호출부는 행을 읽지 않는다(왕복을 늘리지 않는다).
 */
export function stageSyncNeedsLiveRowCounts(
  groups: readonly StageSyncGroup[],
  settings: StageSyncSettings = {},
): boolean {
  return duplicateCandidates(sortGroups(groups), settings).size > 0;
}

/**
 * 그룹 ↔ 진행현황 단계 연결(2026-10-06 제품 책임자 결정, #845) — «단계 = 보드 그룹».
 *
 * 그룹(띠)의 이름·순서·추가가 바뀌면 단계 목록이 그대로 따라오게 선택지와 이동 규칙을 다시 짠다.
 * 순수 함수다 — 쓰기는 호출부(서비스·설치기)가 `changed` 일 때만 한다.
 *
 *   · 그룹마다(정렬 순서대로) «대표 선택지» 하나 = 규칙이 그 그룹을 가리키는 선택지.
 *     여럿이면 라벨이 그룹 이름과 같은 것 → 본문이 같은 것 → 목록에서 앞선 것.
 *     대표의 라벨 = 그룹 이름, 선택지 순서 = 그룹 순서. **선택지 id 는 절대 안 바뀐다**
 *     (`item_values`·발송 규칙의 trigger_value 가 id 로 묶여 있다).
 *   · 대표가 없는 그룹 → 그룹 id 에서 나온 고정 id 로 새 선택지 + 규칙 항목.
 *   · 그룹이 사라진 선택지 → id 는 그대로, 규칙만 잃는다(값만 바뀌는 단계, 맨 뒤).
 *   · 빈 설치기 복제(앞선 같은 본문 이름의 그룹이 있고 · 설치기 이름 그대로이고 · 살아 있는 행 0)
 *     → 선택지를 받지 않는다. 그 복제를 가리키던 규칙은 같은 본문 이름의 «원래» 그룹으로 옮긴다.
 *   · 대표가 아닌 나머지(같은 그룹을 가리키는 별칭)는 라벨·규칙을 그대로 두고 대표들 뒤에 둔다.
 *
 * 행 수(`liveRowCounts`)를 모르면 «증거» 로만 판단한다: 아무 규칙도 가리키지 않는 후보만 빈 복제로 보고,
 * 규칙이 가리키는 후보는 그대로 둔다(새 선택지를 만들지도, 규칙을 옮기지도 않는다).
 *
 * 규칙이 비었거나 없으면(회사가 «이동 끄기» 로 둔 칸) 연결하지 않는다 — null.
 * 그룹이 하나도 없어도 null(규칙을 지울 근거로 쓰지 않는다).
 */
export function syncGroupLinkedStageColumn(
  column: Pick<BoardColumn, "type" | "move_rule_jsonb" | "options_jsonb">,
  groups: readonly StageSyncGroup[],
  liveRowCounts?: ReadonlyMap<string, number>,
  settings: StageSyncSettings = {},
): StageSyncPlan | null {
  if (column.type !== "select" && column.type !== "status") return null;
  const storedRule = column.move_rule_jsonb;
  if (!storedRule || Object.keys(storedRule).length === 0) return null;
  if (groups.length === 0) return null;

  const storedOptions = column.options_jsonb?.options ?? [];
  const sorted = sortGroups(groups);
  const groupIds = new Set(sorted.map((group) => group.id));
  const ruleTargets = new Set(Object.values(storedRule));

  // 빈 설치기 복제 → 그 복제가 대신하려던 원래 그룹(같은 본문 이름 중 맨 앞).
  const ignored = new Map<string, string>();
  for (const [groupId, keeper] of duplicateCandidates(sorted, settings)) {
    const empty = liveRowCounts
      ? (liveRowCounts.get(groupId) ?? 0) === 0
      : !ruleTargets.has(groupId);
    if (empty) ignored.set(groupId, keeper.id);
  }

  // 규칙 정리 — 사라진 그룹은 버리고, 빈 복제를 가리키던 항목은 원래 그룹으로 옮긴다.
  const rule: Record<string, string> = {};
  for (const [key, target] of Object.entries(storedRule)) {
    if (typeof target !== "string" || !groupIds.has(target)) continue;
    rule[key] = ignored.get(target) ?? target;
  }

  const indexOf = new Map(storedOptions.map((option, index) => [option.id, index]));
  const optionById = new Map(storedOptions.map((option) => [option.id, option]));
  const primaries: FieldOption[] = [];
  const primaryIds = new Set<string>();
  for (const group of sorted) {
    if (ignored.has(group.id)) continue;
    const candidates = storedOptions.filter((option) => option.archived !== true && rule[option.id] === group.id);
    let primary: FieldOption | undefined;
    if (candidates.length > 0) {
      const groupKey = plainGroupName(group.name);
      primary = candidates.find((option) => option.label === group.name)
        ?? candidates.find((option) => plainGroupName(option.label) === groupKey)
        ?? [...candidates].sort((left, right) => (indexOf.get(left.id) ?? 0) - (indexOf.get(right.id) ?? 0))[0];
    }
    const derivedId = stageOptionIdForGroup(group.id);
    // 손으로 고친 규칙이 이 그룹의 고정 id 를 다른 그룹의 대표로 써 버렸다 — 같은 id 를 둘 만들 수 없으니 건너뛴다.
    if (!primary && primaryIds.has(derivedId)) continue;
    // 행 수를 모르면(증거만) 같은 본문 이름의 다른 그룹이 이미 단계를 받고 있을 때 새 단계를 만들지 않는다.
    // 그 다른 그룹이 «규칙이 가리키는 빈 복제» 일 수 있다 — 행 수를 아는 동기화가 규칙을 이 그룹으로 옮기며
    // 정리한다. 여기서 만들면 그때 같은 그룹에 단계가 둘(대표 + 옛 이름 별칭) 남는다.
    if (!primary && !optionById.has(derivedId) && !liveRowCounts && sameNameGroupLinked(group, sorted, rule)) continue;
    if (!primary && optionById.has(derivedId)) {
      // 예전에 이 그룹을 위해 만든 선택지가 규칙만 잃고 남아 있다 — 새로 만들지 않고 다시 잇는다.
      primary = optionById.get(derivedId);
    }
    const next: FieldOption = primary
      ? { ...primary, label: group.name }
      : {
        id: derivedId,
        label: group.name,
        ...(group.color && HEX_COLOR.test(group.color) ? { color: group.color } : {}),
      };
    delete next.archived;
    rule[next.id] = group.id;
    primaryIds.add(next.id);
    primaries.push(next);
  }

  const linked = (option: FieldOption) => option.archived !== true && rule[option.id] !== undefined;
  const aliases = storedOptions.filter((option) => !primaryIds.has(option.id) && linked(option));
  const rest = storedOptions.filter((option) => !primaryIds.has(option.id) && !linked(option));
  const options = [...primaries, ...aliases, ...rest].map((option, order) => ({ ...option, order }));

  const changed = canonical(options) !== canonical(storedOptions) || canonical(rule) !== canonical(storedRule);
  return { options, moveRule: rule, changed };
}
