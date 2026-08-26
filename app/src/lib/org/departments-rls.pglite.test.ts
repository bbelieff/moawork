import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/130_issue571_departments.sql"),
  "utf8",
);

const ids = {
  orgA: "00000000-0000-4000-8000-0000000000a1",
  orgB: "00000000-0000-4000-8000-0000000000b1",
  deptA: "00000000-0000-4000-8000-00000000d0a1",
  deptB: "00000000-0000-4000-8000-00000000d0b1",
  ownerA: "00000000-0000-4000-8000-00000000001a",
  memberA: "00000000-0000-4000-8000-00000000002a",
  ownerB: "00000000-0000-4000-8000-00000000001b",
  outsider: "00000000-0000-4000-8000-00000000009f",
};

const SCHEMA = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  create table public.orgs(id uuid primary key);
  create table public.users(id uuid primary key);
  create table public.org_members(
    org_id uuid not null references public.orgs(id), user_id uuid not null references public.users(id),
    role text not null, status text not null default 'active', primary key(org_id,user_id)
  );
  create function public.is_org_member(p_org_id uuid) returns boolean language sql stable as
    $$ select exists(select 1 from public.org_members where org_id=p_org_id and user_id=auth.uid() and status='active') $$;
  create function public.require_owner(p_org_id uuid) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
  declare v_actor uuid := auth.uid();
  begin
    if not exists(select 1 from public.org_members where org_id=p_org_id and user_id=v_actor and status='active' and role in ('owner','admin')) then
      raise exception 'owner required' using errcode='42501';
    end if;
    return v_actor;
  end $$;
  create function public.begin_guarded_migration(
    p_logical_key text, p_file_name text, p_file_digest text,
    p_expected_predecessor text, p_executor text, p_thread_id text, p_foundation boolean
  ) returns void language sql as $$ select $$;

  create table public.departments(
    id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id) on delete cascade,
    parent_id uuid, name text not null, key text not null, head_user_id uuid references public.users(id),
    sort_order int not null default 0, archived_at timestamptz, created_by uuid not null references public.users(id),
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    unique(org_id,key), unique(id,org_id), foreign key(parent_id,org_id) references public.departments(id,org_id)
  );
  create table public.department_members(
    org_id uuid not null references public.orgs(id) on delete cascade, dept_id uuid not null,
    user_id uuid not null references public.users(id), role text not null default 'member',
    is_primary boolean not null default true, joined_at timestamptz not null default now(),
    primary key(dept_id,user_id), foreign key(dept_id,org_id) references public.departments(id,org_id) on delete cascade
  );

  create function public.create_org_department(p_org_id uuid,p_parent_id uuid,p_name text,p_key text,p_head_user_id uuid,p_request_id uuid)
  returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
  declare v_actor uuid;
  begin
    v_actor := public.require_owner(p_org_id);
    insert into public.departments(org_id,parent_id,name,key,head_user_id,created_by)
    values(p_org_id,p_parent_id,p_name,p_key,p_head_user_id,v_actor);
    return jsonb_build_object('accepted',true);
  end $$;
  create function public.move_org_department(uuid,uuid,uuid,uuid) returns jsonb language sql security definer set search_path=public,pg_temp as $$ select '{}'::jsonb $$;
  create function public.set_org_department_head(uuid,uuid,uuid,uuid) returns jsonb language sql security definer set search_path=public,pg_temp as $$ select '{}'::jsonb $$;
  create function public.archive_org_department(uuid,uuid,uuid) returns jsonb language sql security definer set search_path=public,pg_temp as $$ select '{}'::jsonb $$;
  create function public.assign_org_department_member(uuid,uuid,uuid,uuid) returns jsonb language sql security definer set search_path=public,pg_temp as $$ select '{}'::jsonb $$;
  create function public.unassign_org_department_member(uuid,uuid,uuid) returns jsonb language sql security definer set search_path=public,pg_temp as $$ select '{}'::jsonb $$;

  grant usage on schema public,auth to authenticated;
  grant execute on function auth.uid() to authenticated;
  grant select on public.org_members,public.orgs,public.users to authenticated;
  insert into public.orgs(id) values ('${ids.orgA}'),('${ids.orgB}');
  insert into public.users(id) values ('${ids.ownerA}'),('${ids.memberA}'),('${ids.ownerB}'),('${ids.outsider}');
  insert into public.org_members(org_id,user_id,role) values
    ('${ids.orgA}','${ids.ownerA}','owner'),('${ids.orgA}','${ids.memberA}','member'),('${ids.orgB}','${ids.ownerB}','owner');
  insert into public.departments(id,org_id,name,key,created_by) values
    ('${ids.deptA}','${ids.orgA}','A 영업','sales','${ids.ownerA}'),
    ('${ids.deptB}','${ids.orgB}','B 영업','sales','${ids.ownerB}');
  insert into public.department_members(org_id,dept_id,user_id) values
    ('${ids.orgA}','${ids.deptA}','${ids.memberA}'),('${ids.orgB}','${ids.deptB}','${ids.ownerB}');
`;

const databases: PGlite[] = [];
afterEach(async () => Promise.all(databases.splice(0).map((db) => db.close())));

async function boot() {
  const db = new PGlite();
  databases.push(db);
  await db.exec(SCHEMA);
  await db.exec(migration);
  return db;
}

async function as<T>(db: PGlite, userId: string, sql: string) {
  await db.exec(`reset role; select set_config('app.uid','${userId}',false); set role authenticated;`);
  try {
    return await db.query<T>(sql);
  } finally {
    await db.exec("reset role");
  }
}

describe("#571 canonical 050/076 부서 계약 repair", () => {
  it("기존 고객 행과 canonical 표를 그대로 보존하고 중복 표를 만들지 않는다", async () => {
    const db = await boot();
    const departments = await db.query<{ id: string; name: string }>("select id,name from public.departments order by id");
    const members = await db.query("select org_id,dept_id,user_id from public.department_members order by dept_id");
    const duplicate = await db.query<{ duplicate: string | null }>("select to_regclass('public.org_member_departments')::text as duplicate");
    expect(departments.rows).toEqual([{ id: ids.deptA, name: "A 영업" }, { id: ids.deptB, name: "B 영업" }]);
    expect(members.rows).toHaveLength(2);
    expect(duplicate.rows[0].duplicate).toBeNull();
  });

  it("active 조직원만 자기 회사 조직도를 읽고 다른 회사는 보지 못한다", async () => {
    const db = await boot();
    const owner = await as<{ name: string }>(db, ids.ownerA, "select name from public.departments order by name");
    const member = await as<{ user_id: string }>(db, ids.memberA, "select user_id from public.department_members");
    const outsider = await as(db, ids.outsider, "select id from public.departments");
    expect(owner.rows).toEqual([{ name: "A 영업" }]);
    expect(member.rows).toEqual([{ user_id: ids.memberA }]);
    expect(outsider.rows).toEqual([]);
  });

  it("직접 DML은 owner도 거부하고 감사 owner RPC만 성공한다", async () => {
    const db = await boot();
    await expect(as(db, ids.ownerA, `insert into public.departments(org_id,name,key,created_by) values('${ids.orgA}','직접','direct','${ids.ownerA}')`)).rejects.toThrow();
    await expect(as(db, ids.memberA, `select public.create_org_department('${ids.orgA}',null,'멤버','member',null,gen_random_uuid())`)).rejects.toThrow();
    await as(db, ids.ownerA, `select public.create_org_department('${ids.orgA}',null,'대표 생성','owner-created',null,gen_random_uuid())`);
    const rows = await as<{ name: string }>(db, ids.ownerA, "select name from public.departments order by name");
    expect(rows.rows.map((row) => row.name)).toEqual(["A 영업", "대표 생성"]);
  });

  it("canonical composite FK가 다른 회사 부서를 자기 회사 배정으로 위장하지 못하게 한다", async () => {
    const db = await boot();
    await expect(db.exec(`insert into public.department_members(org_id,dept_id,user_id) values('${ids.orgA}','${ids.deptB}','${ids.memberA}')`)).rejects.toThrow();
  });
});
