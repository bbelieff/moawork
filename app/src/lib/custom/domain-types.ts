/**
 * 커스텀필드 도메인 타입 — 공용 계약 `@/lib/types` 재export (정합 완료).
 *
 * 이력: 착수 시점엔 T03 파운데이션(`@/lib/types`)이 main 에 없어 001 정의를 이 파일에
 * vendor 했다. T03 랜딩 후 **재export 로 통합** — 정의의 단일 출처는 `@/lib/types` 이고,
 * 본 파일은 core.custom 내부의 얇은 seam 으로만 남는다(모듈 내 import 경로 불변).
 */

export {
  FIELD_ENTITIES,
  FIELD_TYPES,
  type FieldEntity,
  type FieldType,
  type FieldOption,
  type FieldDef,
  type FieldValue,
  type SavedView,
} from "@/lib/types";
