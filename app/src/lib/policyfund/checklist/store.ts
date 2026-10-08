import type { SupabaseClient } from "@supabase/supabase-js";
import type { DealChecklistState, ProductChecklistPreset } from "./types";

export interface ChecklistStore {
  listPresets(orgId: string): Promise<ProductChecklistPreset[]>;
  getPreset(orgId: string, productId: string): Promise<ProductChecklistPreset | null>;
  savePreset(orgId: string, preset: ProductChecklistPreset): Promise<void>;
  getDealChecklist(orgId: string, dealId: string): Promise<DealChecklistState | null>;
  saveDealChecklist(orgId: string, state: DealChecklistState): Promise<void>;
}

/** 한 번에 묶는 거래 id 수 — uuid 100개면 주소가 약 4KB 다. */
const DEAL_CHECKLIST_BATCH = 100;

export class SupabaseChecklistStore implements ChecklistStore {
  constructor(private readonly client: SupabaseClient) {}

  async listPresets(orgId: string): Promise<ProductChecklistPreset[]> {
    const { data, error } = await this.client.from("policyfund_checklist_presets").select("product_id,items_jsonb,updated_at").eq("org_id", orgId).order("product_id");
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({ productId: row.product_id, items: row.items_jsonb, updatedAt: row.updated_at }));
  }

  async getPreset(orgId: string, productId: string): Promise<ProductChecklistPreset | null> {
    const { data, error } = await this.client.from("policyfund_checklist_presets").select("product_id,items_jsonb,updated_at").eq("org_id", orgId).eq("product_id", productId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { productId: data.product_id, items: data.items_jsonb, updatedAt: data.updated_at } : null;
  }
  async savePreset(orgId: string, preset: ProductChecklistPreset): Promise<void> {
    const { error } = await this.client.from("policyfund_checklist_presets").upsert({ org_id: orgId, product_id: preset.productId, items_jsonb: preset.items, updated_at: preset.updatedAt }, { onConflict: "org_id,product_id" });
    if (error) throw new Error(error.message);
  }
  async getDealChecklist(orgId: string, dealId: string): Promise<DealChecklistState | null> {
    const { data, error } = await this.client.from("deal_document_checklists").select("deal_id,product_id,items_jsonb").eq("org_id", orgId).eq("deal_id", dealId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { dealId: data.deal_id, productId: data.product_id, items: data.items_jsonb } : null;
  }
  /**
   * Issue 857 — 여러 거래의 체크리스트를 한 번에(대시보드). 전에는 거래마다 한 번씩 읽었다.
   * 주소 길이 때문에 id 를 나눠 묶음마다 한 번 읽고(묶음끼리는 같이), 없는 거래는 지도에 넣지 않는다.
   */
  async listDealChecklists(orgId: string, dealIds: readonly string[]): Promise<Map<string, DealChecklistState>> {
    const unique = [...new Set(dealIds)];
    const chunks: string[][] = [];
    for (let index = 0; index < unique.length; index += DEAL_CHECKLIST_BATCH) chunks.push(unique.slice(index, index + DEAL_CHECKLIST_BATCH));
    const pages = await Promise.all(chunks.map((ids) =>
      this.client.from("deal_document_checklists").select("deal_id,product_id,items_jsonb").eq("org_id", orgId).in("deal_id", ids)));
    const result = new Map<string, DealChecklistState>();
    for (const { data, error } of pages) {
      if (error) throw new Error(error.message);
      for (const row of data ?? []) result.set(row.deal_id, { dealId: row.deal_id, productId: row.product_id, items: row.items_jsonb });
    }
    return result;
  }
  async saveDealChecklist(orgId: string, state: DealChecklistState): Promise<void> {
    const { error } = await this.client.from("deal_document_checklists").upsert({ org_id: orgId, deal_id: state.dealId, product_id: state.productId, items_jsonb: state.items, updated_at: new Date().toISOString() }, { onConflict: "org_id,deal_id" });
    if (error) throw new Error(error.message);
  }
}
