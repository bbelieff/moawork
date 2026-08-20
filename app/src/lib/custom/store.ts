/**
 * 커스텀 저장소 포트 + 인메모리 어댑터 (T05 core.custom).
 *
 * field_defs / field_values / saved_views(001_schema_v1) 의 영속성 포트.
 * 모든 메서드는 orgId 로 **앱 레이어 스코핑**(DB RLS 는 T03; 이 계층은 독립적 테넌트 격리).
 * 인메모리 어댑터 = 참조 구현 + 테스트/개발용.
 *
 * 정합(followup): 공유 포트 `@/lib/repo`(Repo)가 현재 listFieldDefs/createFieldDef 만
 * 노출한다. T02 재작성 정착 후, 이 CustomStore 표면(값/뷰/update/reorder/delete 포함)으로
 * Repo 를 넓히거나 어댑터로 위임한다. 지금은 자기완결 구현으로 결합을 피한다.
 */

import type { FieldDef, FieldEntity, FieldOption, SavedView } from "./domain-types";
import type { JsonValue } from "./field-types";

// ── 입력 타입(id/정렬은 스토어가 채움) ──────────────────────

export interface NewFieldDef {
  entity: FieldEntity;
  key: string;
  label: string;
  type: FieldDef["type"];
  options?: FieldOption[];
  moduleKey?: string | null;
}

export interface FieldDefPatch {
  label?: string;
  options?: FieldOption[];
  sortOrder?: number;
}

export interface NewSavedView {
  userId: string | null;
  entity: FieldEntity;
  name: string;
  filters_jsonb: SavedView["filters_jsonb"];
  sort_jsonb: SavedView["sort_jsonb"];
  columns_jsonb: SavedView["columns_jsonb"];
  shared: boolean;
}

export interface SavedViewPatch {
  name?: string;
  filters_jsonb?: SavedView["filters_jsonb"];
  sort_jsonb?: SavedView["sort_jsonb"];
  columns_jsonb?: SavedView["columns_jsonb"];
  shared?: boolean;
}

export interface CustomStore {
  // field_defs
  listDefs(orgId: string, entity?: FieldEntity): Promise<FieldDef[]>;
  getDef(orgId: string, defId: string): Promise<FieldDef | null>;
  createDef(orgId: string, def: NewFieldDef): Promise<FieldDef>;
  updateDef(orgId: string, defId: string, patch: FieldDefPatch): Promise<FieldDef | null>;
  reorderDefs(orgId: string, entity: FieldEntity, orderedIds: string[]): Promise<void>;
  /** 정의만 삭제한다. 값은 같은 key 정의가 복구될 때 다시 연결되도록 보존한다. */
  deleteDef(orgId: string, defId: string): Promise<boolean>;

  // field_values (entity_id = company.id | deal.id)
  getValues(orgId: string, entity: FieldEntity, entityId: string): Promise<Record<string, JsonValue | null>>;
  setValue(orgId: string, entity: FieldEntity, entityId: string, fieldKey: string, value: JsonValue | null): Promise<void>;

  // saved_views
  listViews(orgId: string, userId: string | null, entity?: FieldEntity): Promise<SavedView[]>;
  getView(orgId: string, viewId: string): Promise<SavedView | null>;
  createView(orgId: string, view: NewSavedView): Promise<SavedView>;
  updateView(orgId: string, viewId: string, patch: SavedViewPatch): Promise<SavedView | null>;
  deleteView(orgId: string, viewId: string): Promise<boolean>;
}

export interface InMemoryOptions {
  genId?: () => string;
}

/** 인메모리 어댑터 — 참조 구현 + 개발/테스트. */
export class InMemoryCustomStore implements CustomStore {
  private defs = new Map<string, FieldDef>();
  private views = new Map<string, SavedView>();
  /** field_values PK(entity, entity_id, field_key) → 값. */
  private values = new Map<string, { orgId: string; value: JsonValue | null }>();

  private seq = 0;
  private readonly genId: () => string;

  constructor(opts: InMemoryOptions = {}) {
    this.genId = opts.genId ?? (() => `id-${++this.seq}`);
  }

  private valKey(entity: FieldEntity, entityId: string, fieldKey: string): string {
    return `${entity}::${entityId}::${fieldKey}`;
  }

  async listDefs(orgId: string, entity?: FieldEntity): Promise<FieldDef[]> {
    return [...this.defs.values()]
      .filter((d) => d.org_id === orgId && (entity === undefined || d.entity === entity))
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  async getDef(orgId: string, defId: string): Promise<FieldDef | null> {
    const d = this.defs.get(defId);
    return d && d.org_id === orgId ? d : null;
  }

  async createDef(orgId: string, def: NewFieldDef): Promise<FieldDef> {
    const siblings = await this.listDefs(orgId, def.entity);
    const row: FieldDef = {
      id: this.genId(),
      org_id: orgId,
      entity: def.entity,
      key: def.key,
      label: def.label,
      type: def.type,
      options_jsonb: def.options ? { options: def.options } : null,
      module_key: def.moduleKey ?? null,
      sort_order: siblings.reduce((m, d) => Math.max(m, d.sort_order), -1) + 1,
    };
    this.defs.set(row.id, row);
    return row;
  }

  async updateDef(orgId: string, defId: string, patch: FieldDefPatch): Promise<FieldDef | null> {
    const d = await this.getDef(orgId, defId);
    if (!d) return null;
    const next: FieldDef = {
      ...d,
      label: patch.label ?? d.label,
      options_jsonb: patch.options !== undefined ? { options: patch.options } : d.options_jsonb,
      sort_order: patch.sortOrder ?? d.sort_order,
    };
    this.defs.set(defId, next);
    return next;
  }

  async reorderDefs(orgId: string, entity: FieldEntity, orderedIds: string[]): Promise<void> {
    let order = 0;
    const seen = new Set<string>();
    for (const id of orderedIds) {
      const d = this.defs.get(id);
      if (!d || d.org_id !== orgId || d.entity !== entity || seen.has(id)) continue;
      seen.add(id);
      this.defs.set(id, { ...d, sort_order: order++ });
    }
    // 목록 밖 정의는 기존 순서 유지하며 뒤로.
    const rest = [...this.defs.values()]
      .filter((d) => d.org_id === orgId && d.entity === entity && !seen.has(d.id))
      .sort((a, b) => a.sort_order - b.sort_order);
    for (const d of rest) this.defs.set(d.id, { ...d, sort_order: order++ });
  }

  async deleteDef(orgId: string, defId: string): Promise<boolean> {
    const d = await this.getDef(orgId, defId);
    if (!d) return false;
    this.defs.delete(defId);
    return true;
  }

  async getValues(orgId: string, entity: FieldEntity, entityId: string): Promise<Record<string, JsonValue | null>> {
    const out: Record<string, JsonValue | null> = {};
    const prefix = `${entity}::${entityId}::`;
    for (const [k, v] of this.values) {
      if (v.orgId !== orgId || !k.startsWith(prefix)) continue;
      out[k.slice(prefix.length)] = v.value;
    }
    return out;
  }

  async setValue(
    orgId: string,
    entity: FieldEntity,
    entityId: string,
    fieldKey: string,
    value: JsonValue | null,
  ): Promise<void> {
    const k = this.valKey(entity, entityId, fieldKey);
    if (value === null) this.values.delete(k); // null = 빈 셀 = 삭제
    else this.values.set(k, { orgId, value });
  }

  async listViews(orgId: string, userId: string | null, entity?: FieldEntity): Promise<SavedView[]> {
    return [...this.views.values()]
      .filter((v) => v.org_id === orgId && (entity === undefined || v.entity === entity))
      // 가시성: 공유 뷰 ∪ 내 개인 뷰.
      .filter((v) => v.shared || v.user_id === userId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getView(orgId: string, viewId: string): Promise<SavedView | null> {
    const v = this.views.get(viewId);
    return v && v.org_id === orgId ? v : null;
  }

  async createView(orgId: string, view: NewSavedView): Promise<SavedView> {
    const row: SavedView = {
      id: this.genId(),
      org_id: orgId,
      user_id: view.userId,
      entity: view.entity,
      name: view.name,
      filters_jsonb: view.filters_jsonb,
      sort_jsonb: view.sort_jsonb,
      columns_jsonb: view.columns_jsonb,
      shared: view.shared,
    };
    this.views.set(row.id, row);
    return row;
  }

  async updateView(orgId: string, viewId: string, patch: SavedViewPatch): Promise<SavedView | null> {
    const v = await this.getView(orgId, viewId);
    if (!v) return null;
    const next: SavedView = {
      ...v,
      name: patch.name ?? v.name,
      filters_jsonb: patch.filters_jsonb ?? v.filters_jsonb,
      sort_jsonb: patch.sort_jsonb ?? v.sort_jsonb,
      columns_jsonb: patch.columns_jsonb ?? v.columns_jsonb,
      shared: patch.shared ?? v.shared,
    };
    this.views.set(viewId, next);
    return next;
  }

  async deleteView(orgId: string, viewId: string): Promise<boolean> {
    const v = await this.getView(orgId, viewId);
    if (!v) return false;
    this.views.delete(viewId);
    return true;
  }
}
