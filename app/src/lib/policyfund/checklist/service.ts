import { addItem, applyPreset, completionOf, removeItem, toPresetItems, toggleItem } from "./engine";
import type { ChecklistStore } from "./store";
import type { ChecklistCompletion, DealChecklistState, ProductChecklistPreset } from "./types";
import { assertValidChecklistState, canonicalChecklistItems } from "./schema";

export class NoProductSelectedError extends Error {
  constructor() { super("먼저 진행 상품을 선택해야 프리셋으로 저장할 수 있습니다"); }
}

export class ChecklistService {
  constructor(private readonly orgId: string, private readonly store: ChecklistStore) {}
  listPresets() { return this.store.listPresets(this.orgId); }
  getPresetForProduct(productId: string) { return this.store.getPreset(this.orgId, productId); }
  async getDealChecklist(dealId: string): Promise<DealChecklistState> { return (await this.store.getDealChecklist(this.orgId, dealId)) ?? { caseId: dealId, dealId, productId: null, items: [], version: 0 }; }
  async completion(dealId: string): Promise<ChecklistCompletion> { return completionOf((await this.getDealChecklist(dealId)).items); }
  private save(cur: DealChecklistState, next: DealChecklistState, requestId: string, expectedVersion = cur.version ?? 0) { return this.store.saveDealChecklist(this.orgId,next,{requestId,expectedVersion}); }
  saveExact(
    state: DealChecklistState,
    identity: { requestId: string; expectedVersion: number },
  ) {
    assertValidChecklistState(state);
    return this.store.saveDealChecklist(this.orgId, state, identity);
  }
  async applyProduct(dealId: string, productId: string, requestId: string, expectedVersion?: number) { const preset=await this.getPresetForProduct(productId); if(!preset) await this.setPreset(productId,[]); const cur=await this.getDealChecklist(dealId); const next={...cur,caseId:dealId,dealId,productId,items:applyPreset(preset?.items??null)}; return this.save(cur,next,requestId,expectedVersion); }
  async toggleItem(dealId:string,itemId:string,requestId:string){const cur=await this.getDealChecklist(dealId);const next={...cur,items:toggleItem(cur.items,itemId)};return this.save(cur,next,requestId);}
  async addItem(dealId:string,label:string,requestId:string){const cur=await this.getDealChecklist(dealId);const next={...cur,items:addItem(cur.items,label)};return this.save(cur,next,requestId);}
  async removeItem(dealId:string,itemId:string,requestId:string){const cur=await this.getDealChecklist(dealId);const next={...cur,items:removeItem(cur.items,itemId)};return this.save(cur,next,requestId);}
  async saveAsPreset(dealId:string){const cur=await this.getDealChecklist(dealId);if(!cur.productId)throw new NoProductSelectedError();const preset={productId:cur.productId,items:toPresetItems(cur.items),updatedAt:new Date().toISOString()};await this.store.savePreset(this.orgId,preset);return preset;}
  async saveAsPresetExact(snapshot: DealChecklistState) {
    const caseId = snapshot.caseId ?? snapshot.dealId;
    if (caseId !== snapshot.dealId || !Number.isSafeInteger(snapshot.version) || (snapshot.version ?? -1) < 0) {
      throw new Error("checklist preset snapshot invalid");
    }
    const current = await this.getDealChecklist(caseId);
    assertValidChecklistState(current);
    assertValidChecklistState(snapshot);
    const sameSnapshot = current.version === snapshot.version
      && current.productId === snapshot.productId
      && JSON.stringify(canonicalChecklistItems(current.items))
        === JSON.stringify(canonicalChecklistItems(snapshot.items));
    if (!sameSnapshot) throw new Error("checklist version conflict");
    if (!snapshot.productId) throw new NoProductSelectedError();
    const preset = {
      productId: snapshot.productId,
      items: toPresetItems(snapshot.items),
      updatedAt: new Date().toISOString(),
    };
    await this.store.savePreset(this.orgId, preset);
    return preset;
  }
  async setPreset(productId:string,items:{label:string}[]){const normalizedProductId=productId.trim();if(!normalizedProductId)throw new NoProductSelectedError();const preset:ProductChecklistPreset={productId:normalizedProductId,items:items.map(x=>x.label.trim()).filter(Boolean).map((label,i)=>({id:`doc-${i+1}-${label.replace(/\s+/g,"")}`,label,order:i})),updatedAt:new Date().toISOString()};await this.store.savePreset(this.orgId,preset);return preset;}
}
