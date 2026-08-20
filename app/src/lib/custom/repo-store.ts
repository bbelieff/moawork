/**
 * CustomStore ↔ 공용 Repo 어댑터 (T05 정합).
 *
 * 순수 엔진(field-types/options/views/validation)과 서비스는 `CustomStore` 포트만 알고,
 * 실제 영속성은 공용 `@/lib/repo` 가 담당한다(LocalRepo → 추후 SupabaseRepo 스왑).
 * 테스트는 `InMemoryCustomStore`(참조 구현)를 그대로 쓴다.
 */

import { getRepo, type Repo } from "@/lib/repo";
import type { FieldDef, FieldEntity, SavedView } from "./domain-types";
import type { JsonValue } from "./field-types";
import { CustomService } from "./service";
import type {
  CustomStore,
  FieldDefPatch,
  NewFieldDef,
  NewSavedView,
  SavedViewPatch,
} from "./store";

export class RepoCustomStore implements CustomStore {
  constructor(private readonly repo: Repo = getRepo()) {}

  // ── field_defs ──
  async listDefs(orgId: string, entity?: FieldEntity): Promise<FieldDef[]> {
    return this.repo.listFieldDefs(orgId, entity);
  }

  async getDef(orgId: string, defId: string): Promise<FieldDef | null> {
    return this.repo.getFieldDef(orgId, defId) ?? null;
  }

  async createDef(orgId: string, def: NewFieldDef): Promise<FieldDef> {
    const siblings = this.repo.listFieldDefs(orgId, def.entity);
    return this.repo.createFieldDef({
      org_id: orgId,
      entity: def.entity,
      key: def.key,
      label: def.label,
      type: def.type,
      options_jsonb: def.options ? { options: def.options } : null,
      module_key: def.moduleKey ?? null,
      sort_order: siblings.reduce((m, d) => Math.max(m, d.sort_order), -1) + 1,
    });
  }

  async updateDef(orgId: string, defId: string, patch: FieldDefPatch): Promise<FieldDef | null> {
    return (
      this.repo.updateFieldDef(orgId, defId, {
        label: patch.label,
        options: patch.options,
        sort_order: patch.sortOrder,
      }) ?? null
    );
  }

  async reorderDefs(orgId: string, entity: FieldEntity, orderedIds: string[]): Promise<void> {
    this.repo.reorderFieldDefs(orgId, entity, orderedIds);
  }

  async deleteDef(orgId: string, defId: string): Promise<boolean> {
    return this.repo.deleteFieldDef(orgId, defId);
  }

  // ── field_values ──
  async getValues(orgId: string, entity: FieldEntity, entityId: string): Promise<Record<string, JsonValue | null>> {
    return this.repo.getFieldValues(orgId, entity, entityId) as Record<string, JsonValue | null>;
  }

  async setValue(
    orgId: string,
    entity: FieldEntity,
    entityId: string,
    fieldKey: string,
    value: JsonValue | null,
  ): Promise<void> {
    this.repo.setFieldValue(orgId, entity, entityId, fieldKey, value);
  }

  // ── saved_views ──
  async listViews(
    orgId: string,
    userId: string | null,
    entity?: FieldEntity,
  ): Promise<SavedView[]> {
    return this.repo.listSavedViews(orgId, userId, entity);
  }

  async getView(orgId: string, viewId: string): Promise<SavedView | null> {
    return this.repo.getSavedView(orgId, viewId) ?? null;
  }

  async createView(orgId: string, view: NewSavedView): Promise<SavedView> {
    return this.repo.createSavedView({
      org_id: orgId,
      user_id: view.userId,
      entity: view.entity,
      name: view.name,
      filters_jsonb: view.filters_jsonb,
      sort_jsonb: view.sort_jsonb,
      columns_jsonb: view.columns_jsonb,
      shared: view.shared,
    });
  }

  async updateView(
    orgId: string,
    viewId: string,
    patch: SavedViewPatch,
  ): Promise<SavedView | null> {
    return this.repo.updateSavedView(orgId, viewId, patch) ?? null;
  }

  async deleteView(orgId: string, viewId: string): Promise<boolean> {
    return this.repo.deleteSavedView(orgId, viewId);
  }
}

/** 요청 처리용 서비스 인스턴스(공유 repo 사용) — T02 `getCrmService()` 규약과 동일. */
export function getCustomService(): CustomService {
  return new CustomService(new RepoCustomStore(), () => crypto.randomUUID());
}
