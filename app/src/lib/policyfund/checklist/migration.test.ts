import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const sql=readFileSync(resolve(process.cwd(),"../supabase/migrations/067_policyfund_document_checklists.sql"),"utf8");
describe("BBE-110 migration boundary",()=>{
  it("uses new tables with RLS and qualified outer org/deal ownership",()=>{expect(sql).toContain("enable row level security");expect(sql).toContain("is_org_member(public.deal_document_checklists.org_id)");expect(sql).toContain("d.id=public.deal_document_checklists.deal_id and d.org_id=public.deal_document_checklists.org_id");expect(sql).not.toContain("d.org_id=org_id");});
  it("does not mutate prior migrations or customer rows",()=>{expect(sql).not.toMatch(/\b(update|delete from)\s+(orgs|deals|companies)\b/i);});
});
