import { describe, expect, it } from "vitest";
import { ChecklistService, NoProductSelectedError } from "./service";
import type { ChecklistStore } from "./store";
import type { DealChecklistState, ProductChecklistPreset } from "./types";
class MemoryStore implements ChecklistStore { presets=new Map<string,ProductChecklistPreset>();deals=new Map<string,DealChecklistState>();getPreset(o:string,p:string){return Promise.resolve(this.presets.get(`${o}/${p}`)??null);}savePreset(o:string,p:ProductChecklistPreset){this.presets.set(`${o}/${p.productId}`,structuredClone(p));return Promise.resolve();}getDealChecklist(o:string,d:string){return Promise.resolve(structuredClone(this.deals.get(`${o}/${d}`)??null));}saveDealChecklist(o:string,s:DealChecklistState){this.deals.set(`${o}/${s.dealId}`,structuredClone(s));return Promise.resolve();}}
describe("ChecklistService persistent contract",()=>{
it("applies preset and survives re-instantiation",async()=>{const s=new MemoryStore(),a=new ChecklistService("a",s);await a.setPreset("상품",[{label:"서류1"},{label:"서류2"}]);await a.applyProduct("d","상품");const first=(await a.getDealChecklist("d")).items[0];await a.toggleItem("d",first.id);expect((await new ChecklistService("a",s).getDealChecklist("d")).items[0].checked).toBe(true);});
it("isolates orgs and deals",async()=>{const s=new MemoryStore(),a=new ChecklistService("a",s),b=new ChecklistService("b",s);await a.applyProduct("d","상품");await a.addItem("d","서류");expect((await b.getDealChecklist("d")).items).toEqual([]);expect((await a.getDealChecklist("other")).items).toEqual([]);});
it("saves reusable unchecked preset",async()=>{const s=new MemoryStore(),a=new ChecklistService("a",s);await a.applyProduct("d1","상품");await a.addItem("d1","서류");await a.toggleItem("d1",(await a.getDealChecklist("d1")).items[0].id);await a.saveAsPreset("d1");expect((await a.applyProduct("d2","상품")).items).toMatchObject([{label:"서류",checked:false}]);});
it("requires product before saving preset",async()=>{await expect(new ChecklistService("a",new MemoryStore()).saveAsPreset("d")).rejects.toBeInstanceOf(NoProductSelectedError);});
});
