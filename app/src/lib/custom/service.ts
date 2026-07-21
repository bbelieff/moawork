/**
 * core.custom 서비스 오케스트레이션 (T05).
 *
 * 스토어(CustomStore) 위에서 유스케이스를 조립한다:
 *  - 필드 생성 시 유니크 key 파생 + select/multiselect 옵션 id 발급.
 *  - 값 설정 시 각 필드 타입 스펙으로 정규화(레지스트리 경유).
 *  - 프리셋(module_key) 필드 옵션 편집 락.
 *  - 저장뷰 CRUD(개인/공유 가시성).
 */

import type { FieldDef, FieldEntity, FieldOption, SavedView } from "./domain-types";
import {
  ValidationError,
  getFieldTypeSpec,
  type JsonValue,
} from "./field-types";
import { addOption } from "./options";
import type { CustomStore, NewSavedView, SavedViewPatch } from "./store";
import { deriveKey, uniqueKey } from "./validation";
import { fromViewConfig, pickDefaultView, toViewConfig, type ViewConfig } from "./views";

export class CustomFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomFieldError";
  }
}

export interface CreateFieldOptions {
  entity: FieldEntity;
  label: string;
  type: FieldDef["type"];
  /** select/multiselect 초기 옵션 라벨. */
  optionLabels?: string[];
  moduleKey?: string | null;
}

export class CustomService {
  constructor(
    private readonly store: CustomStore,
    private readonly genId: () => string,
  ) {}

  // ── 필드 정의 ─────────────────────────────────────────────

  async listFields(orgId: string, entity?: FieldEntity): Promise<FieldDef[]> {
    return this.store.listDefs(orgId, entity);
  }

  async createField(orgId: string, input: CreateFieldOptions): Promise<FieldDef> {
    const existing = await this.store.listDefs(orgId, input.entity);
    const key = uniqueKey(input.label, existing.map((d) => d.key));

    const spec = getFieldTypeSpec(input.type);
    let options: FieldOption[] | undefined;
    if (input.optionLabels && input.optionLabels.length > 0) {
      if (!spec.supportsOptions)
        throw new ValidationError(`${input.type} 타입은 선택지를 가질 수 없습니다`);
      options = [];
      for (const label of input.optionLabels) {
        options = addOption(options, { label }, this.genId);
      }
    }

    return this.store.createDef(orgId, {
      entity: input.entity,
      key,
      label: input.label,
      type: input.type,
      options,
      moduleKey: input.moduleKey ?? null,
    });
  }

  async renameField(orgId: string, defId: string, label: string): Promise<FieldDef> {
    const def = await this.requireDef(orgId, defId);
    const trimmed = label.trim();
    if (trimmed === "") throw new ValidationError("label: 비어 있을 수 없습니다");
    deriveKey(trimmed); // key 파생 가능성만 검사(실제 key 는 불변).
    const next = await this.store.updateDef(orgId, defId, { label: trimmed });
    return next ?? def;
  }

  async reorderFields(orgId: string, entity: FieldEntity, orderedIds: string[]): Promise<void> {
    await this.store.reorderDefs(orgId, entity, orderedIds);
  }

  async deleteField(orgId: string, defId: string): Promise<boolean> {
    const def = await this.store.getDef(orgId, defId);
    if (def?.module_key)
      throw new CustomFieldError("프리셋(업종팩) 필드는 삭제할 수 없습니다");
    return this.store.deleteDef(orgId, defId);
  }

  // ── 옵션 편집(프리셋 락) ──────────────────────────────────

  /**
   * 옵션 목록 교체(add/rename/reorder/archive 결과를 서비스 밖에서 계산해 전달).
   * module_key 필드는 편집 락(프리셋 값 = T09/002 소유).
   */
  async setOptions(orgId: string, defId: string, options: FieldOption[]): Promise<FieldDef> {
    const def = await this.requireDef(orgId, defId);
    if (def.module_key)
      throw new CustomFieldError("프리셋(업종팩) 필드의 선택지는 편집할 수 없습니다");
    if (!getFieldTypeSpec(def.type).supportsOptions)
      throw new ValidationError(`${def.type} 타입은 선택지를 가질 수 없습니다`);
    const next = await this.store.updateDef(orgId, defId, { options });
    return next ?? def;
  }

  // ── 값 ───────────────────────────────────────────────────

  async getValues(orgId: string, entityId: string): Promise<Record<string, JsonValue | null>> {
    return this.store.getValues(orgId, entityId);
  }

  /**
   * 값 설정 — 각 key 를 해당 field_def 타입 스펙으로 정규화 후 저장.
   * 알 수 없는(정의 없는) key 는 무시(마이그레이션 중 안전).
   * null/빈 값은 셀 삭제. entity 는 field_def 로 판별하므로 호출부가 지정.
   */
  async setValues(
    orgId: string,
    entity: FieldEntity,
    entityId: string,
    patch: Record<string, unknown>,
  ): Promise<Record<string, JsonValue | null>> {
    const defs = await this.store.listDefs(orgId, entity);
    const byKey = new Map(defs.map((d) => [d.key, d]));

    for (const [key, raw] of Object.entries(patch)) {
      const def = byKey.get(key);
      if (!def) continue; // 정의 없는 key 무시
      const options = def.options_jsonb?.options ?? [];
      const value = getFieldTypeSpec(def.type).normalize(raw, { options });
      await this.store.setValue(orgId, entityId, key, value);
    }
    return this.store.getValues(orgId, entityId);
  }

  // ── 저장뷰 ───────────────────────────────────────────────

  async listViews(orgId: string, userId: string | null, entity?: FieldEntity): Promise<SavedView[]> {
    return this.store.listViews(orgId, userId, entity);
  }

  async createView(
    orgId: string,
    userId: string | null,
    input: { entity: FieldEntity; name: string; config: ViewConfig; shared: boolean },
  ): Promise<SavedView> {
    const jsonb = fromViewConfig(input.config);
    const view: NewSavedView = {
      userId,
      entity: input.entity,
      name: input.name,
      filters_jsonb: jsonb.filters_jsonb,
      sort_jsonb: jsonb.sort_jsonb,
      columns_jsonb: jsonb.columns_jsonb,
      shared: input.shared,
    };
    return this.store.createView(orgId, view);
  }

  async updateView(
    orgId: string,
    viewId: string,
    patch: { name?: string; config?: ViewConfig; shared?: boolean },
  ): Promise<SavedView | null> {
    const storePatch: SavedViewPatch = {};
    if (patch.name !== undefined) storePatch.name = patch.name;
    if (patch.shared !== undefined) storePatch.shared = patch.shared;
    if (patch.config !== undefined) {
      const jsonb = fromViewConfig(patch.config);
      storePatch.filters_jsonb = jsonb.filters_jsonb;
      storePatch.sort_jsonb = jsonb.sort_jsonb;
      storePatch.columns_jsonb = jsonb.columns_jsonb;
    }
    return this.store.updateView(orgId, viewId, storePatch);
  }

  async deleteView(orgId: string, viewId: string): Promise<boolean> {
    return this.store.deleteView(orgId, viewId);
  }

  /**
   * 기본 뷰 조회 — 화면 최초 진입 시 적용할 뷰.
   * 규약(OQ-4): shared 우선 → name ASC → id ASC. 스키마 변경 없음(`views.ts` 참조).
   * 뷰가 하나도 없으면 null(호출부가 "전체 보기" 기본값 처리).
   */
  async getDefaultView(
    orgId: string,
    userId: string | null,
    entity: FieldEntity,
  ): Promise<SavedView | null> {
    return pickDefaultView(await this.store.listViews(orgId, userId, entity));
  }

  /** SavedView row → 내부 ViewConfig(적용/편집용). */
  viewConfigOf(view: SavedView): ViewConfig {
    return toViewConfig(view);
  }

  // ── 내부 ─────────────────────────────────────────────────

  private async requireDef(orgId: string, defId: string): Promise<FieldDef> {
    const def = await this.store.getDef(orgId, defId);
    if (!def) throw new CustomFieldError(`필드 정의를 찾을 수 없습니다(${defId})`);
    return def;
  }
}
