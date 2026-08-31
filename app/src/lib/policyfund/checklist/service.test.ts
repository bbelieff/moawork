import { describe, expect, it } from "vitest";
import { ChecklistService, NoProductSelectedError } from "./service";
import type { ChecklistStore } from "./store";
import type { DealChecklistState, ProductChecklistPreset } from "./types";
class MemoryStore implements ChecklistStore {
  presets=new Map<string,ProductChecklistPreset>();deals=new Map<string,DealChecklistState>();
  receipts=new Map<string,{digest:string;result:DealChecklistState}>();
  listPresets(o:string){return Promise.resolve([...this.presets].filter(([k])=>k.startsWith(`${o}/`)).map(([,v])=>structuredClone(v)));}
  getPreset(o:string,p:string){return Promise.resolve(this.presets.get(`${o}/${p}`)??null);}
  savePreset(o:string,p:ProductChecklistPreset){this.presets.set(`${o}/${p.productId}`,structuredClone(p));return Promise.resolve();}
  getDealChecklist(o:string,d:string){return Promise.resolve(structuredClone(this.deals.get(`${o}/${d}`)??null));}
  saveDealChecklist(o:string,s:DealChecklistState,identity:{requestId:string;expectedVersion:number}){
    const receiptKey=`${o}/${identity.requestId}`;
    const digest=JSON.stringify({dealId:s.dealId,expectedVersion:identity.expectedVersion,productId:s.productId,items:s.items});
    const receipt=this.receipts.get(receiptKey);
    if(receipt){if(receipt.digest!==digest)return Promise.reject(new Error("checklist request mismatch"));return Promise.resolve(structuredClone(receipt.result));}
    const key=`${o}/${s.dealId}`;const current=this.deals.get(key);
    if((current?.version??0)!==identity.expectedVersion)return Promise.reject(new Error("checklist version conflict"));
    const next={...structuredClone(s),caseId:s.caseId??s.dealId,version:identity.expectedVersion+1};
    this.deals.set(key,next);this.receipts.set(receiptKey,{digest,result:structuredClone(next)});return Promise.resolve(next);
  }
}
describe("ChecklistService persistent contract",()=>{
it("applies preset and survives re-instantiation",async()=>{const s=new MemoryStore(),a=new ChecklistService("a",s);await a.setPreset("상품",[{label:"서류1"},{label:"서류2"}]);await a.applyProduct("d","상품",crypto.randomUUID());const first=(await a.getDealChecklist("d")).items[0];await a.toggleItem("d",first.id,crypto.randomUUID());expect((await new ChecklistService("a",s).getDealChecklist("d")).items[0].checked).toBe(true);});
it("isolates orgs and deals",async()=>{const s=new MemoryStore(),a=new ChecklistService("a",s),b=new ChecklistService("b",s);await a.applyProduct("d","상품",crypto.randomUUID());await a.addItem("d","서류",crypto.randomUUID());expect((await b.getDealChecklist("d")).items).toEqual([]);expect((await a.getDealChecklist("other")).items).toEqual([]);});
it("saves reusable unchecked preset",async()=>{const s=new MemoryStore(),a=new ChecklistService("a",s);await a.applyProduct("d1","상품",crypto.randomUUID());await a.addItem("d1","서류",crypto.randomUUID());await a.toggleItem("d1",(await a.getDealChecklist("d1")).items[0].id,crypto.randomUUID());await a.saveAsPreset("d1");expect((await a.applyProduct("d2","상품",crypto.randomUUID())).items).toMatchObject([{label:"서류",checked:false}]);});
it("requires product before saving preset",async()=>{await expect(new ChecklistService("a",new MemoryStore()).saveAsPreset("d")).rejects.toBeInstanceOf(NoProductSelectedError);});
it("saves only the semantic clicked snapshot independent of JSONB object key order",async()=>{const s=new MemoryStore(),a=new ChecklistService("a",s);await a.applyProduct("d","상품",crypto.randomUUID());await a.addItem("d","첫째",crypto.randomUUID());const current=await a.addItem("d","둘째",crypto.randomUUID());const originalPreset=await a.getPresetForProduct("상품");for(const changed of [{...current,version:(current.version??0)-1},{...current,productId:"다른 상품"},{...current,items:current.items.map((item,index)=>index===0?{...item,label:"변경"}:item)},{...current,items:[...current.items].reverse()}]){await expect(a.saveAsPresetExact(changed)).rejects.toThrow(/version conflict/);expect(await a.getPresetForProduct("상품")).toEqual(originalPreset);}const reordered={...current,items:current.items.map((item)=>({id:item.id,label:item.label,checked:item.checked,order:item.order}))};const preset=await a.saveAsPresetExact(reordered);expect(preset.items).toMatchObject([{label:"첫째"},{label:"둘째"}]);});
it("rejects malformed preset snapshots before writing",async()=>{const s=new MemoryStore(),a=new ChecklistService("a",s);await a.applyProduct("d","상품",crypto.randomUUID());const current=await a.addItem("d","서류",crypto.randomUUID());const malformed={...current,items:[{...current.items[0],extra:"x"}]};await expect(a.saveAsPresetExact(malformed as never)).rejects.toThrow(/schema invalid/);expect((await a.getPresetForProduct("상품"))?.items).toEqual([]);});
it("rejects malformed product ids before store mutation while preserving explicit clear",async()=>{const s=new MemoryStore(),a=new ChecklistService("a",s);for(const productId of [1,{},[]]){expect(()=>a.saveExact({caseId:"d",dealId:"d",productId:productId as never,items:[],version:0},{requestId:crypto.randomUUID(),expectedVersion:0})).toThrow(/schema invalid/);}expect(s.deals.size).toBe(0);expect(s.receipts.size).toBe(0);await expect(a.saveExact({caseId:"d",dealId:"d",productId:null,items:[],version:0},{requestId:crypto.randomUUID(),expectedVersion:0})).resolves.toMatchObject({productId:null});});
it("persists a newly typed product in the existing org preset registry",async()=>{const store=new MemoryStore(),svc=new ChecklistService("a",store);await svc.applyProduct("d","새 지원 상품",crypto.randomUUID());expect((await svc.listPresets()).map(x=>x.productId)).toEqual(["새 지원 상품"]);expect((await svc.getDealChecklist("d")).productId).toBe("새 지원 상품");});
it("replays the exact local request and rejects mismatch/stale without partial state",async()=>{const store=new MemoryStore();const initial:{dealId:string;productId:null;items:never[];version:number}={dealId:"d",productId:null,items:[],version:0};const first=await store.saveDealChecklist("a",initial,{requestId:"r",expectedVersion:0});expect(await store.saveDealChecklist("a",initial,{requestId:"r",expectedVersion:0})).toEqual(first);await expect(store.saveDealChecklist("a",{...initial,productId:"x"},{requestId:"r",expectedVersion:0})).rejects.toThrow(/mismatch/);await expect(store.saveDealChecklist("a",initial,{requestId:"stale",expectedVersion:0})).rejects.toThrow(/conflict/);expect((await store.getDealChecklist("a","d"))?.version).toBe(1);});
});
