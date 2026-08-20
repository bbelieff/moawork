import type { SupabaseClient } from "@supabase/supabase-js";
import type { FieldDef, FieldEntity, SavedView } from "./domain-types";
import type { JsonValue } from "./field-types";
import type { CustomStore, FieldDefPatch, NewFieldDef, NewSavedView, SavedViewPatch } from "./store";

type Row = Record<string, unknown>;

function fail(error: { message?: string } | null): void {
  if (error) throw new Error(error.message ?? "Supabase custom-field query failed");
}

/** Request-scoped hosted adapter. The authenticated client and RLS enforce tenant isolation. */
export class SupabaseCustomStore implements CustomStore {
  constructor(private readonly client: SupabaseClient) {}

  async listDefs(orgId: string, entity?: FieldEntity): Promise<FieldDef[]> {
    let query = this.client.from("field_defs").select("*").eq("org_id", orgId);
    if (entity) query = query.eq("entity", entity);
    const result = await query.order("sort_order");
    fail(result.error);
    return (result.data ?? []) as FieldDef[];
  }

  async getDef(orgId: string, defId: string): Promise<FieldDef | null> {
    const result = await this.client.from("field_defs").select("*").eq("org_id", orgId).eq("id", defId).maybeSingle();
    fail(result.error);
    return (result.data as FieldDef | null) ?? null;
  }

  async createDef(orgId: string, def: NewFieldDef): Promise<FieldDef> {
    const siblings = await this.listDefs(orgId, def.entity);
    const result = await this.client.from("field_defs").insert({
      org_id: orgId,
      entity: def.entity,
      key: def.key,
      label: def.label,
      type: def.type,
      options_jsonb: def.options ? { options: def.options } : null,
      module_key: def.moduleKey ?? null,
      sort_order: siblings.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1,
    }).select("*").single();
    fail(result.error);
    return result.data as FieldDef;
  }

  async updateDef(orgId: string, defId: string, patch: FieldDefPatch): Promise<FieldDef | null> {
    const dbPatch: Row = {};
    if (patch.label !== undefined) dbPatch.label = patch.label;
    if (patch.options !== undefined) dbPatch.options_jsonb = patch.options ? { options: patch.options } : null;
    if (patch.sortOrder !== undefined) dbPatch.sort_order = patch.sortOrder;
    const result = await this.client.from("field_defs").update(dbPatch).eq("org_id", orgId).eq("id", defId).select("*").maybeSingle();
    fail(result.error);
    return (result.data as FieldDef | null) ?? null;
  }

  async reorderDefs(orgId: string, entity: FieldEntity, orderedIds: string[]): Promise<void> {
    const defs = await this.listDefs(orgId, entity);
    const order = [...orderedIds, ...defs.map((def) => def.id).filter((id) => !orderedIds.includes(id))];
    for (const [sortOrder, id] of order.entries()) {
      const result = await this.client.from("field_defs").update({ sort_order: sortOrder }).eq("org_id", orgId).eq("entity", entity).eq("id", id);
      fail(result.error);
    }
  }

  async deleteDef(orgId: string, defId: string): Promise<boolean> {
    // field_values has no FK to field_defs. Delete only the definition so same-key recreation restores values.
    const result = await this.client.from("field_defs").delete().eq("org_id", orgId).eq("id", defId).select("id");
    fail(result.error);
    return (result.data?.length ?? 0) > 0;
  }

  async getValues(orgId: string, entity: FieldEntity, entityId: string): Promise<Record<string, JsonValue | null>> {
    const result = await this.client.from("field_values").select("field_key,value_jsonb").eq("org_id", orgId).eq("entity", entity).eq("entity_id", entityId);
    fail(result.error);
    return Object.fromEntries(((result.data ?? []) as Array<{ field_key: string; value_jsonb: JsonValue | null }>).map((row) => [row.field_key, row.value_jsonb]));
  }

  async setValue(orgId: string, entity: FieldEntity, entityId: string, fieldKey: string, value: JsonValue | null): Promise<void> {
    const table = this.client.from("field_values");
    const result = value === null
      ? await table.delete().eq("org_id", orgId).eq("entity", entity).eq("entity_id", entityId).eq("field_key", fieldKey)
      : await table.upsert({ org_id: orgId, entity, entity_id: entityId, field_key: fieldKey, value_jsonb: value }, { onConflict: "entity,entity_id,field_key" });
    fail(result.error);
  }

  async listViews(orgId: string, userId: string | null, entity?: FieldEntity): Promise<SavedView[]> {
    let query = this.client.from("saved_views").select("*").eq("org_id", orgId).or(`shared.eq.true,user_id.eq.${userId ?? "00000000-0000-0000-0000-000000000000"}`);
    if (entity) query = query.eq("entity", entity);
    const result = await query.order("name");
    fail(result.error);
    return (result.data ?? []) as SavedView[];
  }

  async getView(orgId: string, viewId: string): Promise<SavedView | null> {
    const result = await this.client.from("saved_views").select("*").eq("org_id", orgId).eq("id", viewId).maybeSingle();
    fail(result.error);
    return (result.data as SavedView | null) ?? null;
  }

  async createView(orgId: string, view: NewSavedView): Promise<SavedView> {
    const result = await this.client.from("saved_views").insert({ org_id: orgId, user_id: view.userId, entity: view.entity, name: view.name, filters_jsonb: view.filters_jsonb, sort_jsonb: view.sort_jsonb, columns_jsonb: view.columns_jsonb, shared: view.shared }).select("*").single();
    fail(result.error);
    return result.data as SavedView;
  }

  async updateView(orgId: string, viewId: string, patch: SavedViewPatch): Promise<SavedView | null> {
    const result = await this.client.from("saved_views").update(patch).eq("org_id", orgId).eq("id", viewId).select("*").maybeSingle();
    fail(result.error);
    return (result.data as SavedView | null) ?? null;
  }

  async deleteView(orgId: string, viewId: string): Promise<boolean> {
    const result = await this.client.from("saved_views").delete().eq("org_id", orgId).eq("id", viewId).select("id");
    fail(result.error);
    return (result.data?.length ?? 0) > 0;
  }
}
