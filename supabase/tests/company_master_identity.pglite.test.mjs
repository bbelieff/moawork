import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dependencyRoot = process.env.PGLITE_MODULE_ROOT ?? root;
const { PGlite } = await import(pathToFileURL(path.join(
  dependencyRoot, "node_modules", "@electric-sql", "pglite", "dist", "index.js",
)).href);
const migrationPath = path.join(root, "supabase", "migrations", "065_company_master_identity.sql");

const ORG_A = "00000000-0000-4000-8000-000000000001";
const ORG_B = "00000000-0000-4000-8000-000000000002";
const USER = "00000000-0000-4000-8000-000000000010";
const OTHER_USER = "00000000-0000-4000-8000-000000000011";

async function bootstrap(db) {
  await db.exec(`
    create schema auth;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create type public.member_role as enum ('owner','admin','team_lead','member');
    create type public.member_scope as enum ('all','assigned');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table public.orgs(id uuid primary key);
    create table public.users(id uuid primary key);
    create table public.org_members(
      org_id uuid not null references public.orgs(id), user_id uuid not null references public.users(id),
      role public.member_role not null, scope public.member_scope not null, status text not null,
      primary key(org_id,user_id)
    );
    create function public.is_org_member(p_org uuid) returns boolean language sql stable security definer
    set search_path='' as $$
      select exists(select 1 from public.org_members m where m.org_id=p_org and m.user_id=auth.uid() and m.status='active')
    $$;
    create function public.org_role(p_org uuid) returns public.member_role language sql stable security definer
    set search_path='' as $$
      select m.role from public.org_members m where m.org_id=p_org and m.user_id=auth.uid() and m.status='active'
    $$;
    create function public.org_scope(p_org uuid) returns public.member_scope language sql stable security definer
    set search_path='' as $$
      select m.scope from public.org_members m where m.org_id=p_org and m.user_id=auth.uid() and m.status='active'
    $$;
    create table public.companies(
      id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id),
      name text not null, biz_type text, region text, owner_name text, phone text, email text,
      revenue numeric, founded_on date, homepage text, assigned_to uuid references public.users(id),
      created_at timestamptz not null default now()
    );
    create table public.deals(
      id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id),
      company_id uuid references public.companies(id), assigned_to uuid references public.users(id),
      title text not null default 'Fixture'
    );
    insert into public.orgs(id) values ('${ORG_A}'),('${ORG_B}');
    insert into public.users(id) values ('${USER}'),('${OTHER_USER}');
    insert into public.org_members(org_id,user_id,role,scope,status)
      values ('${ORG_A}','${USER}','member','assigned','active');
    select set_config('request.jwt.claim.sub','${USER}',false);
  `);
}

async function handoff(db, dealId, {
  name,
  bizNo = null,
  ownerName = null,
  businessType = null,
  industry = null,
  regionSido = null,
  regionSigungu = null,
  phone = null,
  foundedOn = null,
  revenue = null,
  companyId = null,
} = {}, orgId = ORG_A) {
  await db.exec(`set role authenticated`);
  try {
    return await db.query(`select * from public.handoff_company_to_work($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [
      orgId, dealId, name, bizNo, ownerName, businessType, industry,
      regionSido, regionSigungu, phone, foundedOn, revenue, companyId,
    ]);
  } finally {
    await db.exec(`reset role`);
  }
}

test("BBE-125 handoff reuses exact identity and keeps suspected duplicates separate", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    await db.exec(await readFile(migrationPath, "utf8"));

    const existing = "00000000-0000-4000-8000-000000000101";
    const dealExact = "00000000-0000-4000-8000-000000000201";
    const dealNew = "00000000-0000-4000-8000-000000000202";
    const dealSuspect = "00000000-0000-4000-8000-000000000203";
    await db.query(`insert into public.companies(id,org_id,name,biz_no,owner_name,assigned_to) values($1,$2,'새봄상사','123-45-67890','오새봄',$3)`, [existing, ORG_A, USER]);
    for (const id of [dealExact, dealNew, dealSuspect]) {
      await db.query(`insert into public.deals(id,org_id,assigned_to) values($1,$2,$3)`, [id, ORG_A, USER]);
    }

    await db.exec(`grant usage on schema public to authenticated`);

    const exact = await handoff(db, dealExact, { name: "다른 표기", bizNo: "1234567890", ownerName: "다른대표" });
    assert.deepEqual(exact.rows[0], { deal_id: dealExact, company_id: existing, mode: "existing", duplicate_candidate_ids: [] });
    assert.equal(Number((await db.query(`select count(*) from public.companies where org_id=$1`, [ORG_A])).rows[0].count), 1);
    assert.equal((await db.query(`select company_id from public.deals where id=$1`, [dealExact])).rows[0].company_id, existing);

    const created = await handoff(db, dealNew, {
      name: "푸른기술",
      bizNo: "222-33-44444",
      ownerName: "김푸른",
      businessType: "법인",
      industry: "도소매업",
      regionSido: "경기",
      regionSigungu: "김포시",
      phone: "010-1234-5678",
      foundedOn: "2020-03-04",
      revenue: 250000000,
    });
    assert.equal(created.rows[0].mode, "created");
    assert.deepEqual(created.rows[0].duplicate_candidate_ids, []);
    const stored = await db.query(`
      select business_type, industry, biz_type, region_sido, region_sigungu, region,
             owner_name, phone, founded_on::text, revenue::text
        from public.companies where id=$1
    `, [created.rows[0].company_id]);
    assert.deepEqual(stored.rows[0], {
      business_type: "법인",
      industry: "도소매업",
      biz_type: "도소매업",
      region_sido: "경기",
      region_sigungu: "김포시",
      region: "경기 김포시",
      owner_name: "김푸른",
      phone: "010-1234-5678",
      founded_on: "2020-03-04",
      revenue: "250000000",
    });

    const suspect = await handoff(db, dealSuspect, { name: "주식회사 새봄상사", ownerName: "오새봄" });
    assert.equal(suspect.rows[0].mode, "created_needs_review");
    assert.deepEqual(suspect.rows[0].duplicate_candidate_ids, [existing]);
    assert.notEqual(suspect.rows[0].company_id, existing);
    assert.equal(Number((await db.query(`select count(*) from public.company_duplicate_reviews where status='needs_review'`)).rows[0].count), 1);
    assert.equal(Number((await db.query(`select count(*) from public.companies where merged_into is null and normalized_name='새봄상사'`)).rows[0].count), 2);

    await db.exec(`set role authenticated`);
    await assert.rejects(
      db.query(`insert into public.companies(org_id,name,biz_no) values($1,'직접쓰기','777-77-77777')`, [ORG_A]),
      /permission denied/,
    );
    await db.exec(`reset role`);
    await assert.rejects(
      db.query(`insert into public.companies(org_id,name,biz_no) values($1,'중복','123 45 67890')`, [ORG_A]),
      /companies_org_biz_no_active_uidx|duplicate key/,
    );
  } finally {
    await db.close();
  }
});

test("BBE-125 fresh handoff atomically creates one deal and can select an accessible company", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    await db.exec(await readFile(migrationPath, "utf8"));
    await db.exec(`grant usage on schema public to authenticated`);

    const fresh = await handoff(db, null, { name: "Fresh Company", ownerName: "Fresh Owner" });
    assert.equal(fresh.rows[0].mode, "created");
    assert.ok(fresh.rows[0].deal_id);
    assert.equal(Number((await db.query(`select count(*) from public.deals`)).rows[0].count), 1);
    assert.equal((await db.query(`select company_id from public.deals where id=$1`, [fresh.rows[0].deal_id])).rows[0].company_id, fresh.rows[0].company_id);

    const nextDeal = "00000000-0000-4000-8000-000000000204";
    await db.query(`insert into public.deals(id,org_id,assigned_to,title) values($1,$2,$3,'Next')`, [nextDeal, ORG_A, USER]);
    const selected = await handoff(db, nextDeal, { name: "Ignored", companyId: fresh.rows[0].company_id });
    assert.equal(selected.rows[0].company_id, fresh.rows[0].company_id);
    assert.equal(selected.rows[0].mode, "existing");
    assert.equal((await db.query(`select company_id from public.deals where id=$1`, [nextDeal])).rows[0].company_id, fresh.rows[0].company_id);
  } finally {
    await db.close();
  }
});

test("BBE-125 handoff rejects cross-org access and exposes only the constrained RPC", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    await db.exec(await readFile(migrationPath, "utf8"));
    const foreignDeal = "00000000-0000-4000-8000-000000000301";
    const inaccessibleDeal = "00000000-0000-4000-8000-000000000302";
    await db.query(`insert into public.deals(id,org_id,assigned_to) values($1,$2,$3)`, [foreignDeal, ORG_B, USER]);
    await db.query(`insert into public.deals(id,org_id,assigned_to) values($1,$2,$3)`, [inaccessibleDeal, ORG_A, OTHER_USER]);
    await db.exec(`grant usage on schema public to authenticated`);
    await assert.rejects(
      handoff(db, foreignDeal, { name: "침범" }, ORG_B),
      /active membership required/,
    );
    await assert.rejects(
      handoff(db, inaccessibleDeal, { name: "남의 딜" }),
      /deal unavailable/,
    );

    const privileges = await db.query(`
      select
        has_function_privilege('public', 'public.handoff_company_to_work(uuid,uuid,text,text,text,text,text,text,text,text,date,numeric,uuid)', 'execute') as public_execute,
        has_function_privilege('anon', 'public.handoff_company_to_work(uuid,uuid,text,text,text,text,text,text,text,text,date,numeric,uuid)', 'execute') as anon_execute,
        has_function_privilege('authenticated', 'public.handoff_company_to_work(uuid,uuid,text,text,text,text,text,text,text,text,date,numeric,uuid)', 'execute') as authenticated_execute,
        has_table_privilege('authenticated', 'public.company_duplicate_reviews', 'insert') as direct_insert,
        (select relrowsecurity from pg_class where oid='public.company_duplicate_reviews'::regclass) as rls_enabled
    `);
    assert.deepEqual(privileges.rows[0], {
      public_execute: false,
      anon_execute: false,
      authenticated_execute: true,
      direct_insert: false,
      rls_enabled: true,
    });
  } finally {
    await db.close();
  }
});

test("BBE-125 assigned scope neither links nor exposes another assignee's company", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    await db.exec(await readFile(migrationPath, "utf8"));
    const foreignExact = "00000000-0000-4000-8000-000000000401";
    const foreignSuspect = "00000000-0000-4000-8000-000000000402";
    const dealExact = "00000000-0000-4000-8000-000000000403";
    const dealSuspect = "00000000-0000-4000-8000-000000000404";
    await db.query(`
      insert into public.companies(id,org_id,name,biz_no,owner_name,assigned_to) values
        ($1,$3,'Foreign Exact','333-44-55555','Other Owner',$4),
        ($2,$3,'Foreign Suspect',null,'Other Owner',$4)
    `, [foreignExact, foreignSuspect, ORG_A, OTHER_USER]);
    await db.query(`
      insert into public.company_duplicate_reviews(org_id,source_company_id,candidate_company_id)
      values($1,$2,$3)
    `, [ORG_A, foreignExact, foreignSuspect]);
    await db.query(`insert into public.deals(id,org_id,assigned_to) values($1,$3,$4),($2,$3,$4)`, [dealExact, dealSuspect, ORG_A, USER]);
    await db.exec(`grant usage on schema public to authenticated; grant select on public.companies to authenticated`);

    await assert.rejects(
      handoff(db, dealExact, { name: "Different", bizNo: "3334455555" }),
      /company unavailable/,
    );
    assert.equal((await db.query(`select company_id from public.deals where id=$1`, [dealExact])).rows[0].company_id, null);

    const suspect = await handoff(db, dealSuspect, { name: "Foreign Suspect", ownerName: "Other Owner" });
    assert.equal(suspect.rows[0].mode, "created");
    assert.deepEqual(suspect.rows[0].duplicate_candidate_ids, []);
    assert.notEqual(suspect.rows[0].company_id, foreignSuspect);

    await db.exec(`set role authenticated`);
    try {
      const visible = await db.query(`select source_company_id, candidate_company_id from public.company_duplicate_reviews`);
      assert.deepEqual(visible.rows, []);
    } finally {
      await db.exec(`reset role`);
    }
  } finally {
    await db.close();
  }
});

test("BBE-125 concurrent handoffs retain a suspected duplicate review", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    await db.exec(await readFile(migrationPath, "utf8"));
    const firstDeal = "00000000-0000-4000-8000-000000000501";
    const secondDeal = "00000000-0000-4000-8000-000000000502";
    await db.query(`insert into public.deals(id,org_id,assigned_to) values($1,$3,$4),($2,$3,$4)`, [firstDeal, secondDeal, ORG_A, USER]);
    await db.exec(`grant usage on schema public to authenticated`);

    const [first, second] = await Promise.all([
      handoff(db, firstDeal, { name: "Race Company", ownerName: "Race Owner" }),
      handoff(db, secondDeal, { name: "Race Company", ownerName: "Race Owner" }),
    ]);

    assert.deepEqual(
      [first.rows[0].mode, second.rows[0].mode].sort(),
      ["created", "created_needs_review"],
    );
    assert.equal(Number((await db.query(`select count(*) from public.companies where org_id=$1 and normalized_name='racecompany'`, [ORG_A])).rows[0].count), 2);
    assert.equal(Number((await db.query(`select count(*) from public.company_duplicate_reviews where org_id=$1 and status='needs_review'`, [ORG_A])).rows[0].count), 1);
    assert.equal(
      first.rows[0].duplicate_candidate_ids.length + second.rows[0].duplicate_candidate_ids.length,
      1,
    );
  } finally {
    await db.close();
  }
});
