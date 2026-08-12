/**
 * 필드 출처(source) 레지스트리 — BBE-123 · 결정대장 D09.
 *
 * "타입"(무엇이 들어가는 칸인가)과는 다른 축이다. **출처는 편집 가능 여부를 정한다.**
 * 정본: `docs/design/UI목업_워크스페이스_최종_v6.html` 의 FSRC/SRCMARK.
 *
 * ⚠ `FieldType`(`@/lib/types`)의 "calc"(수식 타입)와 이름이 겹치지만 다른 축이다.
 *   타입 calc = "이 칸엔 계산값이 들어간다", 출처 calc = "이 값은 수식으로 채워졌다".
 *   수식 컬럼은 거의 항상 타입도 calc·출처도 calc 지만, 두 축은 독립적으로 저장한다
 *   (다른 조합 — 예: 출처 lk 인데 타입은 money — 이 실제로 쓰이기 때문).
 */

export const FIELD_SOURCES = ["auto", "in", "act", "msg", "lk", "calc"] as const;
export type FieldSource = (typeof FIELD_SOURCES)[number];

export interface FieldSourceSpec {
  source: FieldSource;
  /** 배지에 쓰는 1글자 기호. */
  mark: string;
  /** 배지 옆 짧은 이름. */
  label: string;
  /** 필터줄 «배지» 도움말 — D09. */
  description: string;
  /** 사람이 셀을 직접 편집할 수 있는가. false 면 클릭해도 편집창을 열지 않는다. */
  editable: boolean;
  /** 편집은 가능하지만 부작용(발송·비용)이 있어 확인 창이 필요한가 — ✉. */
  confirmRequired: boolean;
  /**
   * 배지 색 토큰. 새 hex 를 만들지 않고 기존 --mw-* 팔레트 중 의미가 맞는 것만 쓴다
   * (design-tokens.md — 하드코딩 금지). lk=연동은 --mw-automation, calc=수식은
   * --mw-primary(보라, 결정대장 "수식 → 보라 배경"과 일치).
   *
   * ★ msg(발송)만 danger 다 — BBE-148. 이 칸은 «되돌릴 수 없고 돈이 나가는» 유일한 칸이라
   * 다른 칸과 눈에 띄게 달라야 한다. 중립 톤을 함께 쓰면 ✉ 가 ✎·▼ 와 같은 무게로 보인다.
   * 나머지 3종(auto·in·act)은 전용 색이 없어 중립 톤 하나를 공유한다.
   */
  tone: "neutral" | "automation" | "primary" | "danger";
}

const SPECS: Record<FieldSource, FieldSourceSpec> = {
  auto: {
    source: "auto",
    mark: "⟳",
    label: "수집",
    description: "광고 폼에서 들어옴",
    editable: false,
    confirmRequired: false,
    tone: "neutral",
  },
  in: {
    source: "in",
    mark: "✎",
    label: "입력",
    description: "사람이 씀",
    editable: true,
    confirmRequired: false,
    tone: "neutral",
  },
  act: {
    source: "act",
    mark: "▼",
    label: "버튼",
    description: "눌러서 상태를 바꿈",
    editable: true,
    confirmRequired: false,
    tone: "neutral",
  },
  msg: {
    source: "msg",
    mark: "✉",
    label: "발송",
    description: "바꾸면 고객에게 문자가 나가고 비용이 듭니다",
    editable: true,
    confirmRequired: true,
    tone: "danger",
  },
  lk: {
    source: "lk",
    mark: "⇄",
    label: "연동",
    description: "업체 마스터에서 자동으로 채워집니다",
    editable: false,
    confirmRequired: false,
    tone: "automation",
  },
  calc: {
    source: "calc",
    mark: "ƒ",
    label: "수식",
    description: "계산된 값입니다",
    editable: false,
    confirmRequired: false,
    tone: "primary",
  },
};

export function getFieldSourceSpec(source: FieldSource): FieldSourceSpec {
  return SPECS[source];
}

export function isFieldSource(v: unknown): v is FieldSource {
  return typeof v === "string" && (FIELD_SOURCES as readonly string[]).includes(v);
}

/** 셀을 클릭했을 때 편집창을 열어도 되는가. */
export function isSourceEditable(source: FieldSource): boolean {
  return SPECS[source].editable;
}

/** 저장 전 사용자 확인이 필요한가(✉ 발송 — 비용·되돌릴 수 없음). */
export function sourceRequiresConfirm(source: FieldSource): boolean {
  return SPECS[source].confirmRequired;
}
