// T09 · G8 상태→그룹 자동이동 엔진 (순수 로직).
//
// SSOT: supabase/migrations/004_gaps_and_leadin.sql
//   board_automation_rules(board_id, status_column_key, status_value, to_group_id, enabled)
//   unique (board_id, status_column_key, status_value)
//
// 설계 원칙 — **규칙은 데이터, 엔진은 코드**.
//   먼데이 업무관리 보드의 구체적 그룹 목록(준비→진행→심사→승인→관리→불가)은
//   이 파일에 하드코딩하지 않는다. 규칙 행(board_automation_rules)으로 주입되며,
//   그 시드는 기획/MWC 소관이다. 따라서 그룹 목록이 확정되기 전에도 엔진은 완성 가능하다.
//
// 경계: 영속성(포트/어댑터)·API 라우트는 별건. 이 모듈은 부수효과가 없다.

/** 자동이동 규칙 1건 (004 테이블의 앱 표현). */
export interface AutomationRule {
  id: string;
  board_id: string;
  /** board_columns.key — 감시 대상 상태 컬럼. */
  status_column_key: string;
  /** 상태 라벨 문자열(옵션 라벨). */
  status_value: string;
  /** Stable option identity. New status rules use `label:<provider-id>`. */
  trigger_label_id?: string;
  /** Every condition must match. An empty list preserves legacy behavior. */
  conditions?: readonly AutomationCondition[];
  /** 이동 대상 그룹. */
  to_group_id: string;
  enabled: boolean;
}

export type ConditionOperator = "is" | "is_not";
export type ConditionValueKind = "label_id" | "user_id" | "text";

export interface AutomationCondition {
  column_key: string;
  operator: ConditionOperator;
  value_kind: ConditionValueKind;
  value: string;
}

/** 자동이동 판정 입력 — 아이템의 현재 위치와 바뀐 상태값. */
export interface ItemStateChange {
  item_id: string;
  board_id: string;
  /** 현재 소속 그룹(미배치면 null). */
  group_id: string | null;
  /** 변경된 상태 컬럼 key. */
  status_column_key: string;
  /** 변경 후 상태값. null/빈 값이면 이동 대상 아님. */
  status_value: string | null;
  /** Stable trigger identity for newly imported rules. */
  trigger_label_id?: string | null;
  /** Current item values keyed by condition column. */
  condition_values?: Readonly<Record<string, string | null | undefined>>;
}

export interface AutomationEvaluation {
  decision: MoveDecision | null;
  blocked_reasons: readonly string[];
}

const LABEL_ID = /^label:[A-Za-z0-9_-]+$/u;

export function validateRule(rule: AutomationRule): readonly string[] {
  const errors: string[] = [];
  if (rule.trigger_label_id !== undefined && !LABEL_ID.test(rule.trigger_label_id)) {
    errors.push("트리거 상태값은 label:<id> 형식이어야 합니다.");
  }
  for (const [index, condition] of (rule.conditions ?? []).entries()) {
    if (!condition.column_key.trim()) errors.push(`조건 ${index + 1}: 컬럼이 필요합니다.`);
    if (condition.value_kind === "label_id" && !LABEL_ID.test(condition.value)) {
      errors.push(`조건 ${index + 1}: 상태값은 label:<id> 형식이어야 합니다.`);
    }
  }
  return errors;
}

/** 자동이동 결정. */
export interface MoveDecision {
  item_id: string;
  from_group_id: string | null;
  to_group_id: string;
  /** 판정 근거 규칙 id(감사 로그용). */
  rule_id: string;
}

/**
 * 규칙 조회 키. 004 의 unique(board_id, status_column_key, status_value) 와 동형.
 * 라벨은 공백만 다듬고 대소문자는 보존한다 — 한글 라벨이라 케이스 폴딩은 무의미하고,
 * 옵션 라벨은 정확히 일치해야 오작동이 없다.
 */
function ruleKey(
  boardId: string,
  columnKey: string,
  statusValue: string,
): string {
  return `${boardId}\u0000${columnKey}\u0000${statusValue.trim()}`;
}

function triggerKey(rule: AutomationRule): string {
  return rule.trigger_label_id ?? rule.status_value.trim();
}

function changeTriggerKey(change: ItemStateChange): string | null {
  return change.trigger_label_id ?? change.status_value?.trim() ?? null;
}

/**
 * 규칙 목록 → 조회 인덱스.
 * enabled=false 는 제외한다. 중복 키는 004 unique 제약상 발생하지 않지만,
 * 방어적으로 **먼저 온 규칙을 유지**한다(결정적 동작).
 */
export function indexRules(
  rules: readonly AutomationRule[],
): Map<string, AutomationRule> {
  const idx = new Map<string, AutomationRule>();
  for (const r of rules) {
    if (!r.enabled) continue;
    if (validateRule(r).length > 0) continue;
    const k = ruleKey(r.board_id, r.status_column_key, triggerKey(r));
    if (!idx.has(k)) idx.set(k, r);
  }
  return idx;
}

/**
 * 상태 변경 1건에 대한 자동이동 판정.
 *
 * null 을 반환하는 경우(= 이동 없음):
 *  - 상태값이 null/빈 문자열
 *  - 매칭되는 활성 규칙 없음
 *  - 이미 대상 그룹에 있음(no-op — 무의미한 쓰기·로그 방지)
 */
export function decideMove(
  change: ItemStateChange,
  index: ReadonlyMap<string, AutomationRule>,
): MoveDecision | null {
  return evaluateMove(change, index).decision;
}

/** Evaluate the trigger and every additional condition, retaining all block reasons. */
export function evaluateMove(
  change: ItemStateChange,
  index: ReadonlyMap<string, AutomationRule>,
): AutomationEvaluation {
  const value = changeTriggerKey(change);
  if (!value) return { decision: null, blocked_reasons: ["트리거 상태값이 없습니다."] };

  const rule = index.get(
    ruleKey(change.board_id, change.status_column_key, value),
  );
  if (!rule) return { decision: null, blocked_reasons: ["일치하는 활성 규칙이 없습니다."] };
  const blocked = (rule.conditions ?? []).flatMap((condition) => {
    const actual = change.condition_values?.[condition.column_key] ?? null;
    const matched = actual === condition.value;
    const passes = condition.operator === "is" ? matched : !matched;
    return passes ? [] : [`${condition.column_key}: ${condition.operator} ${condition.value} 조건이 맞지 않습니다.`];
  });
  if (blocked.length > 0) return { decision: null, blocked_reasons: blocked };
  if (change.group_id === rule.to_group_id) return { decision: null, blocked_reasons: ["이미 대상 아이템에 있습니다."] };

  return { decision: {
    item_id: change.item_id,
    from_group_id: change.group_id,
    to_group_id: rule.to_group_id,
    rule_id: rule.id,
  }, blocked_reasons: [] };
}

/** 여러 상태 변경을 일괄 판정한다(이동이 필요한 건만 반환). */
export function decideMoves(
  changes: readonly ItemStateChange[],
  rules: readonly AutomationRule[],
): MoveDecision[] {
  const index = indexRules(rules);
  const out: MoveDecision[] = [];
  for (const c of changes) {
    const d = decideMove(c, index);
    if (d) out.push(d);
  }
  return out;
}

/** 규칙 정합성 위반 1건. */
export interface RuleConflict {
  board_id: string;
  status_column_key: string;
  status_value: string;
  /** 같은 키를 다투는 규칙 id 들. */
  rule_ids: string[];
}

/**
 * 규칙 집합의 충돌 검사 — 같은 (보드, 컬럼, 상태값)에 서로 다른 대상 그룹.
 * 004 unique 제약이 DB 단에서 막지만, 시드/임포트 전 사전 검증용.
 * 비활성 규칙은 검사에서 제외한다.
 */
export function findRuleConflicts(
  rules: readonly AutomationRule[],
): RuleConflict[] {
  const groups = new Map<string, AutomationRule[]>();
  for (const r of rules) {
    if (!r.enabled) continue;
    const k = ruleKey(r.board_id, r.status_column_key, triggerKey(r));
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }

  const conflicts: RuleConflict[] = [];
  for (const list of groups.values()) {
    const targets = new Set(list.map((r) => r.to_group_id));
    if (targets.size > 1) {
      conflicts.push({
        board_id: list[0].board_id,
        status_column_key: list[0].status_column_key,
        status_value: list[0].status_value,
        rule_ids: list.map((r) => r.id),
      });
    }
  }
  return conflicts;
}
