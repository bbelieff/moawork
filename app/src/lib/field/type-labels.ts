/**
 * FieldType 표시 이름 — BBE-123 · D09.
 *
 * 검증 로직(`@/lib/custom/field-types`)과 표시 문자열을 분리했다 — 그 레지스트리는
 * 001 field_type 13종의 **정본 판정**(2중 구현 금지 주석)이라 표시용 필드를 얹지 않는다.
 * 정본: `docs/design/UI목업_워크스페이스_최종_v6.html` 의 FTYPE.
 */
import type { FieldType } from "@/lib/types";

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "텍스트",
  longtext: "문서",
  number: "숫자",
  date: "날짜",
  datetime: "날짜·시각",
  select: "범주",
  multiselect: "다중 범주",
  phone: "전화",
  email: "이메일",
  file: "첨부",
  person: "사람",
  url: "URL",
  checkbox: "체크",
  status: "상태",
  people: "사람 여럿",
  money: "금액",
  calc: "수식",
};

export function fieldTypeLabel(type: FieldType): string {
  return FIELD_TYPE_LABELS[type];
}
