import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const foundation=await readFile(new URL("../migrations/094_migration_apply_guard.sql",import.meta.url),"utf8");
const migration=await readFile(new URL("../migrations/111_bbe264_workspace_owner_deletion_hardening.sql",import.meta.url),"utf8");
const O="10000000-0000-4000-8000-000000000001", OWNER="10000000-0000-4000-8000-000000000002", ADMIN="10000000-0000-4000-8000-000000000003";

test("BBE-264 owner-only confirmed delete/restore is narrow, strict, and customer-DML zero",async()=>{
 const db=new PGlite(); try {
  await db.exec(`create schema auth; create role anon; create role authenticated; create role service_role;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table public.orgs(id uuid primary key,name text,slug text,status text,created_at timestamptz default now(),deletion_requested_at timestamptz,deletion_requested_by uuid);
   create table public.org_members(org_id uuid,user_id uuid,role text,status text);
   create table public.boards(id uuid primary key,org_id uuid); create table public.ledger_entries(id uuid primary key,org_id uuid);
   insert into public.orgs(id,name,slug,status) values('${O}','테스트 회사','test','active');
   insert into public.org_members values('${O}','${OWNER}','owner','active'),('${O}','${ADMIN}','admin','active');
   insert into public.boards values(gen_random_uuid(),'${O}'); insert into public.ledger_entries values(gen_random_uuid(),'${O}');`);
  await db.exec(foundation); await db.exec(`insert into public.migration_apply_guard values('110_bbe171_new_lead_title_audit','110_bbe171_new_lead_title_audit.sql','${"1".repeat(64)}','109_bbe268_migration_frontier_bridge','test','test',clock_timestamp())`); await db.exec(migration);
  await db.exec("grant usage on schema public to authenticated; set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ADMIN]);
  assert.equal((await db.query("select count(*)::int n from public.list_my_workspaces()")).rows[0].n,0);
  await assert.rejects(db.query("select public.request_workspace_deletion($1,$2)",[O,"테스트 회사"]),/only an active owner/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[OWNER]);
  await assert.rejects(db.query("select public.request_workspace_deletion($1,$2)",[O,"틀린 이름"]),/confirmation mismatch/);
  assert.equal((await db.query("select public.request_workspace_deletion($1,$2) status",[O,"테스트 회사"])).rows[0].status,"pending_delete");
  await assert.rejects(db.query("select public.request_workspace_deletion($1,$2)",[O,"테스트 회사"]),/not active/);
  assert.equal((await db.query("select public.restore_workspace_deletion($1) status",[O])).rows[0].status,"active");
  await assert.rejects(db.query("select public.restore_workspace_deletion($1)",[O]),/not pending deletion/);
  await db.exec("reset role");
  assert.deepEqual((await db.query("select (select count(*)::int from boards) boards,(select count(*)::int from ledger_entries) ledger")).rows[0],{boards:1,ledger:1});
  for(const sig of ["public.list_my_workspaces()","public.request_workspace_deletion(uuid,text)","public.restore_workspace_deletion(uuid)"]){const p=(await db.query("select has_function_privilege('public',$1,'execute') p,has_function_privilege('anon',$1,'execute') a,has_function_privilege('service_role',$1,'execute') s,has_function_privilege('authenticated',$1,'execute') u",[sig])).rows[0]; assert.deepEqual(p,{p:false,a:false,s:false,u:true});}
 } finally {await db.close();}
});
