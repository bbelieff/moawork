/**
 * core.custom 배럴 (T05 커스터마이징).
 * 먼데이 컬럼 자유도 재현 — 커스텀필드(13타입) · 선택지(옵션) · 저장뷰.
 * 정본 스키마: supabase/migrations/001_schema_v1.sql (field_defs/field_values/saved_views).
 */

export {
  ValidationError,
  FILTER_OPERATORS,
  getFieldTypeSpec,
  normalizeValue,
  isFieldType,
  operatorAllowed,
  type FieldTypeSpec,
  type FilterOperator,
  type JsonValue,
  type NormalizeCtx,
} from "./field-types";

export {
  addOption,
  renameOption,
  recolorOption,
  reorderOptions,
  archiveOption,
  unarchiveOption,
  activeOptions,
  findOrphanOptionIds,
  type AddOptionInput,
} from "./options";

export {
  applyView,
  matchFilter,
  toViewConfig,
  fromViewConfig,
  pickDefaultView,
  type ViewConfig,
  type ViewFilter,
  type ViewSort,
  type CellResolver,
  type FieldTypeLookup,
  type DefaultViewCandidate,
} from "./views";

export {
  InMemoryCustomStore,
  type CustomStore,
  type NewFieldDef,
  type FieldDefPatch,
  type NewSavedView,
  type SavedViewPatch,
  type InMemoryOptions,
} from "./store";

export {
  deriveKey,
  uniqueKey,
  parseCreateFieldDef,
  parseUpdateFieldDef,
  parseValuesPatch,
  parseViewConfig,
  parseCreateView,
  assertFilterOperators,
  type CreateFieldDefInput,
  type UpdateFieldDefInput,
  type CreateViewInput,
} from "./validation";

export {
  CustomService,
  CustomFieldError,
  type CreateFieldOptions,
} from "./service";

// 영속성 어댑터 — 공용 @/lib/repo 위에서 도는 운영 구현 + 서비스 팩토리.
export { RepoCustomStore, getCustomService } from "./repo-store";

// API 라우트 공용 헬퍼(세션/에러 매핑).
export {
  UnauthorizedError,
  requireCtx,
  jsonOk,
  jsonError,
  toErrorResponse,
  readJson,
} from "./http";
