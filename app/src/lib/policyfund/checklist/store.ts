import type { SupabaseClient } from "@supabase/supabase-js";
import type { DealChecklistState, ProductChecklistPreset } from "./types";
import { CanonicalCaseApi } from "@/lib/case-domain/api";
import type { Ctx } from "@/lib/types";
import { db } from "@/lib/repo/local/store";
import { LocalCrmSource } from "@/lib/repo/supabase/localCrmSource";
import { assertValidChecklistState, canonicalChecklistItems } from "./schema";

export type ChecklistMutationIdentity = {
  requestId: string;
  expectedVersion: number;
};

export interface ChecklistStore {
  listPresets(orgId: string): Promise<ProductChecklistPreset[]>;
  getPreset(orgId: string, productId: string): Promise<ProductChecklistPreset | null>;
  savePreset(orgId: string, preset: ProductChecklistPreset): Promise<void>;
  getDealChecklist(orgId: string, dealId: string): Promise<DealChecklistState | null>;
  saveDealChecklist(
    orgId: string,
    state: DealChecklistState,
    identity: ChecklistMutationIdentity,
  ): Promise<DealChecklistState>;
}

type LocalChecklistState = {
  presets: Map<string, ProductChecklistPreset>;
  deals: Map<string, DealChecklistState>;
  receipts: Map<string, { actorId: string; digest: string; result: DealChecklistState }>;
};
const localChecklistGlobal = globalThis as typeof globalThis & { __moaworkChecklist?: LocalChecklistState };
const localState = () => (localChecklistGlobal.__moaworkChecklist ??= {
  presets: new Map(), deals: new Map(), receipts: new Map(),
});

type LocalChecklistAuthority = Ctx | { testOnly: true };
const isRuntimeCtx = (authority: LocalChecklistAuthority): authority is Ctx => "org" in authority;

function canonicalChecklistCaseId(state: DealChecklistState): string {
  if (state.caseId && state.caseId !== state.dealId) throw new Error("checklist Case alias mismatch");
  return state.caseId ?? state.dealId;
}

/** Local runtime adapter with the same CAS/replay contract as the canonical RPC. */
export class LocalChecklistStore implements ChecklistStore {
  constructor(private readonly authority: LocalChecklistAuthority) {}
  private async canManage(orgId: string, dealId: string): Promise<boolean> {
    if (!isRuntimeCtx(this.authority)) return true;
    if (this.authority.org.id !== orgId) return false;
    const deal = await new LocalCrmSource().getDeal(this.authority, dealId);
    if (!deal?.company_id) return false;
    const company = db().companies.find((row) => row.org_id === orgId && row.id === deal.company_id);
    const activeItems = db().boardItems.filter((row) => row.org_id === orgId && row.deal_id === dealId && !row.deleted_at);
    const mergedInto = (company as typeof company & { merged_into?: string | null } | undefined)?.merged_into;
    return Boolean(company && !mergedInto && activeItems.length === 1);
  }
  listPresets(orgId: string) { return Promise.resolve([...localState().presets].filter(([key]) => key.startsWith(`${orgId}/`)).map(([, value]) => structuredClone(value))); }
  getPreset(orgId: string, productId: string) { return Promise.resolve(structuredClone(localState().presets.get(`${orgId}/${productId}`) ?? null)); }
  savePreset(orgId: string, preset: ProductChecklistPreset) { localState().presets.set(`${orgId}/${preset.productId}`, structuredClone(preset)); return Promise.resolve(); }
  getDealChecklist(orgId: string, dealId: string) {
    return this.canManage(orgId, dealId).then((allowed) => allowed
      ? structuredClone(localState().deals.get(`${orgId}/${dealId}`) ?? null)
      : null);
  }
  async saveDealChecklist(orgId: string, state: DealChecklistState, identity: ChecklistMutationIdentity) {
    const canonicalCaseId = canonicalChecklistCaseId(state);
    if (!await this.canManage(orgId, canonicalCaseId)) return Promise.reject(new Error("case unavailable"));
    assertValidChecklistState(state);
    const normalizedState = {
      ...state, caseId: canonicalCaseId, dealId: canonicalCaseId,
      items: canonicalChecklistItems(state.items),
    };
    const receiptKey = `${orgId}/${identity.requestId}`;
    const actorId = isRuntimeCtx(this.authority) ? this.authority.user.id : "local-test";
    const payload = JSON.stringify({
      caseId: canonicalCaseId,
      expectedVersion: identity.expectedVersion,
      productId: normalizedState.productId,
      items: normalizedState.items,
    });
    const receipt = localState().receipts.get(receiptKey);
    if (receipt) {
      if (receipt.actorId !== actorId || receipt.digest !== payload) return Promise.reject(new Error("checklist request mismatch"));
      return Promise.resolve(structuredClone(receipt.result));
    }
    const key = `${orgId}/${normalizedState.dealId}`;
    const current = localState().deals.get(key);
    if ((current?.version ?? 0) !== identity.expectedVersion) return Promise.reject(new Error("checklist version conflict"));
    const sameDurableState = current
      ? current.productId === normalizedState.productId
        && JSON.stringify(canonicalChecklistItems(current.items)) === JSON.stringify(normalizedState.items)
      : normalizedState.productId === null && normalizedState.items.length === 0;
    const result = {
      ...structuredClone(normalizedState),
      caseId: canonicalCaseId,
      version: sameDurableState ? identity.expectedVersion : identity.expectedVersion + 1,
    };
    if (!sameDurableState) localState().deals.set(key, result);
    localState().receipts.set(receiptKey, { actorId, digest: payload, result: structuredClone(result) });
    return Promise.resolve(result);
  }
}

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
    const { data, error } = await this.client.from("deal_document_checklists").select("deal_id,product_id,items_jsonb,version").eq("org_id", orgId).eq("deal_id", dealId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { caseId: data.deal_id, dealId: data.deal_id, productId: data.product_id, items: data.items_jsonb, version: Number(data.version ?? 0) } : null;
  }
  async saveDealChecklist(
    orgId: string,
    state: DealChecklistState,
    identity: ChecklistMutationIdentity,
  ): Promise<DealChecklistState> {
    const canonicalCaseId = canonicalChecklistCaseId(state);
    assertValidChecklistState(state);
    const result = await new CanonicalCaseApi(this.client).mutateChecklist({
      orgId,
      caseId: canonicalCaseId,
      expectedVersion: identity.expectedVersion,
      requestId: identity.requestId,
      productId: state.productId,
      items: state.items,
    });
    return { ...state, caseId: result.caseId, dealId: result.caseId, version: result.version };
  }
}
