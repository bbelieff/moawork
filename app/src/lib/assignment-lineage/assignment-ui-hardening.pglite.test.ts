import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "../supabase/migrations/135_issue599_assignment_ui_hardening.sql"), "utf8");
const ids = {
  org: "00000000-0000-4000-8000-000000000001",
  deal: "10000000-0000-4000-8000-000000000001",
  item: "20000000-0000-4000-8000-000000000001",
  owner: "30000000-0000-4000-8000-000000000001",
  next: "30000000-0000-4000-8000-000000000002",
};

const schema = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create table public.migration_apply_guard(
  logical_key text primary key,file_name text,file_digest text,expected_predecessor text,
  executor text,thread_id text,applied_at timestamptz default now()
);
insert into public.migration_apply_guard(logical_key) values('134_issue599_assignment_lineage_core');
create function public.begin_guarded_migration(
  p_logical_key text,p_file_name text,p_file_digest text,p_expected_predecessor text,
  p_executor text,p_thread_id text,p_foundation boolean
) returns void language plpgsql as $$ begin
  if p_expected_predecessor<>(select logical_key from public.migration_apply_guard order by applied_at desc limit 1) then
    raise exception 'predecessor mismatch';
  end if;
  insert into public.migration_apply_guard(logical_key,file_name,file_digest,expected_predecessor,executor,thread_id)
  values(p_logical_key,p_file_name,p_file_digest,p_expected_predecessor,p_executor,p_thread_id);
end $$;
create table public.deals(id uuid primary key,assigned_to uuid,applied_on date);
create table public.items(id uuid primary key,deal_id uuid,assigned_to uuid);
create table public.item_values(item_id uuid,column_key text,value_jsonb jsonb,primary key(item_id,column_key));
create table public.legacy_meta_audit(id bigint generated always as identity,deal_id uuid,field_key text);
insert into public.deals values('${ids.deal}','${ids.owner}','2026-08-01');
insert into public.items values('${ids.item}','${ids.deal}','${ids.owner}');
insert into public.item_values values('${ids.item}','owner',to_jsonb('${ids.owner}'::text));
create function public.update_new_lead_intake_meta(
  p_org_id uuid,p_deal_id uuid,p_request_id uuid,p_patch jsonb
) returns table(deal_id uuid,item_id uuid,changed_fields text[],replayed boolean)
language plpgsql security definer set search_path='' as $$
declare v_item uuid;
begin
  select i.id into v_item from public.items i where i.deal_id=p_deal_id;
  if p_patch?'owner' then
    update public.deals d set assigned_to=(p_patch->>'owner')::uuid where d.id=p_deal_id;
    update public.items i set assigned_to=(p_patch->>'owner')::uuid where i.id=v_item;
    update public.item_values v set value_jsonb=to_jsonb(p_patch->>'owner') where v.item_id=v_item and v.column_key='owner';
  end if;
  if p_patch?'applied_on' then
    update public.deals d set applied_on=(p_patch->>'applied_on')::date where d.id=p_deal_id;
  end if;
  insert into public.legacy_meta_audit(deal_id,field_key) select p_deal_id,key from jsonb_each(p_patch);
  return query select p_deal_id,v_item,array(select key from jsonb_each(p_patch) order by key),false;
end $$;
revoke all on function public.update_new_lead_intake_meta(uuid,uuid,uuid,jsonb) from public,anon,service_role;
grant execute on function public.update_new_lead_intake_meta(uuid,uuid,uuid,jsonb) to authenticated;
`;

const databases: PGlite[] = [];
afterEach(async () => { await Promise.all(databases.splice(0).map((db) => db.close())); });

async function boot() {
  const db = new PGlite();
  databases.push(db);
  await db.exec(schema);
  await db.exec(migration);
  return db;
}

async function asAuthenticated(db: PGlite, sql: string) {
  await db.exec("set role authenticated");
  try { return await db.query(sql); }
  finally { await db.exec("reset role"); }
}

async function digest(db: PGlite) {
  return (await db.query(`select md5(row_to_json(x)::text) digest from (
    select d.assigned_to deal_owner,d.applied_on,i.assigned_to item_owner,v.value_jsonb owner_value,
      (select count(*) from legacy_meta_audit)::int audit_count
    from deals d join items i on i.deal_id=d.id join item_values v on v.item_id=i.id and v.column_key='owner'
    where d.id='${ids.deal}'
  ) x`)).rows[0];
}

describe("#599 migration 135 legacy owner-path hardening", () => {
  it("rejects owner before any mixed non-owner field can partially mutate", async () => {
    const db = await boot();
    const before = await digest(db);
    await expect(asAuthenticated(db, `select * from public.update_new_lead_intake_meta(
      '${ids.org}','${ids.deal}','40000000-0000-4000-8000-000000000001',
      jsonb_build_object('owner','${ids.next}','applied_on','2026-09-01'))`)).rejects.toThrow(/assignment owner writes require lineage/i);
    expect(await digest(db)).toEqual(before);
  });

  it.each(["assigned_to", "assignee"])("rejects the %s owner alias with zero mutation", async (key) => {
    const db = await boot();
    const before = await digest(db);
    await expect(asAuthenticated(db, `select * from public.update_new_lead_intake_meta(
      '${ids.org}','${ids.deal}','40000000-0000-4000-8000-000000000002',
      jsonb_build_object('${key}','${ids.next}'))`)).rejects.toThrow(/assignment owner writes require lineage/i);
    expect(await digest(db)).toEqual(before);
  });

  it("preserves permitted non-owner metadata while keeping every owner projection unchanged", async () => {
    const db = await boot();
    await asAuthenticated(db, `select * from public.update_new_lead_intake_meta(
      '${ids.org}','${ids.deal}','40000000-0000-4000-8000-000000000003',
      jsonb_build_object('applied_on','2026-09-01'))`);
    const deal = (await db.query<{ assigned_to: string; applied_on: Date }>(
      `select assigned_to,applied_on from deals where id='${ids.deal}'`,
    )).rows[0];
    expect(deal.assigned_to).toBe(ids.owner);
    expect(deal.applied_on.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect((await db.query("select field_key from legacy_meta_audit")).rows).toEqual([{ field_key: "applied_on" }]);
  });

  it("exposes only the fixed-search-path wrapper to authenticated and keeps the helper private", async () => {
    const db = await boot();
    const acl = (await db.query(`select
      has_function_privilege('authenticated','public.update_new_lead_intake_meta(uuid,uuid,uuid,jsonb)','execute') auth_wrapper,
      has_function_privilege('anon','public.update_new_lead_intake_meta(uuid,uuid,uuid,jsonb)','execute') anon_wrapper,
      has_function_privilege('service_role','public.update_new_lead_intake_meta(uuid,uuid,uuid,jsonb)','execute') service_wrapper,
      has_function_privilege('authenticated','public.update_new_lead_intake_meta_non_owner_legacy(uuid,uuid,uuid,jsonb)','execute') auth_helper`)).rows[0];
    expect(acl).toEqual({ auth_wrapper: true, anon_wrapper: false, service_wrapper: false, auth_helper: false });
    const proc = (await db.query(`select prosecdef,proconfig from pg_proc where oid='public.update_new_lead_intake_meta(uuid,uuid,uuid,jsonb)'::regprocedure`)).rows[0];
    expect(proc).toMatchObject({ prosecdef: true, proconfig: ["search_path=public, pg_temp"] });
    expect((await db.query("select count(*)::int n from migration_apply_guard where logical_key='135_issue599_assignment_ui_hardening'")).rows[0]).toEqual({ n: 1 });
  });
});
