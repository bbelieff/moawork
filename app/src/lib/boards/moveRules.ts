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
