import { addItem, applyPreset, completionOf, removeItem, toPresetItems, toggleItem } from "./engine";
import type { ChecklistStore } from "./store";
import type { ChecklistCompletion, DealChecklistState, ProductChecklistPreset } from "./types";

export class NoProductSelectedError extends Error {
  constructor() { super("먼저 진행 상품을 선택해야 프리셋으로 저장할 수 있습니다"); }
}

export class ChecklistService {
  constructor(private readonly orgId: string, private readonly store: ChecklistStore) {}
  getPresetForProduct(productId: string) { return this.store.getPreset(this.orgId, productId); }
  async getDealChecklist(dealId: string): Promise<DealChecklistState> { return (await this.store.getDealChecklist(this.orgId, dealId)) ?? { dealId, productId: null, items: [] }; }
  async completion(dealId: string): Promise<ChecklistCompletion> { return completionOf((await this.getDealChecklist(dealId)).items); }
  async applyProduct(dealId: string, productId: string) { const preset=await this.getPresetForProduct(productId); const next={dealId,productId,items:applyPreset(preset?.items??null)}; await this.store.saveDealChecklist(this.orgId,next); return next; }
  async toggleItem(dealId:string,itemId:string){const cur=await this.getDealChecklist(dealId);const next={...cur,items:toggleItem(cur.items,itemId)};await this.store.saveDealChecklist(this.orgId,next);return next;}
  async addItem(dealId:string,label:string){const cur=await this.getDealChecklist(dealId);const next={...cur,items:addItem(cur.items,label)};await this.store.saveDealChecklist(this.orgId,next);return next;}
  async removeItem(dealId:string,itemId:string){const cur=await this.getDealChecklist(dealId);const next={...cur,items:removeItem(cur.items,itemId)};await this.store.saveDealChecklist(this.orgId,next);return next;}
  async saveAsPreset(dealId:string){const cur=await this.getDealChecklist(dealId);if(!cur.productId)throw new NoProductSelectedError();const preset={productId:cur.productId,items:toPresetItems(cur.items),updatedAt:new Date().toISOString()};await this.store.savePreset(this.orgId,preset);return preset;}
  async setPreset(productId:string,items:{label:string}[]){const preset:ProductChecklistPreset={productId,items:items.map(x=>x.label.trim()).filter(Boolean).map((label,i)=>({id:`doc-${i+1}-${label.replace(/\s+/g,"")}`,label,order:i})),updatedAt:new Date().toISOString()};await this.store.savePreset(this.orgId,preset);return preset;}
}
