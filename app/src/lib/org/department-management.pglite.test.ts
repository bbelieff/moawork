import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/133_issue571_department_management_ui.sql"),
  "utf8",
);

const id = {
  orgA: "00000000-0000-4000-8000-0000000000a1",
  orgB: "00000000-0000-4000-8000-0000000000b1",
  deptA: "00000000-0000-4000-8000-00000000d0a1",
  deptB: "00000000-0000-4000-8000-00000000d0b1",
  ownerA: "00000000-0000-4000-8000-00000000001a",
  adminA: "00000000-0000-4000-8000-00000000002a",
  memberA: "00000000-0000-4000-8000-00000000003a",
  inactiveA: "00000000-0000-4000-8000-00000000004a",
  ownerB: "00000000-0000-4000-8000-00000000001b",
  outsider: "00000000-0000-4000-8000-00000000009f",
};

const SCHEMA = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create function public.begin_guarded_migration(
  p_logical_key text, p_file_name text, p_file_digest text,
  p_expected_predecessor text, p_executor text, p_thread_id text, p_foundation boolean
) returns void language sql as $$ select $$;
create function public.member_account_session_valid() returns boolean language sql stable as $$ select true $$;

create table public.orgs(id uuid primary key, status text not null default 'active');
create table public.users(id uuid primary key);
create table public.org_members(
  org_id uuid not null references public.orgs(id), user_id uuid not null references public.users(id),
  role text not null, status text not null default 'active', primary key(org_id,user_id)
);
create table public.departments(
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id) on delete cascade,
  parent_id uuid, name text not null, key text not null, head_user_id uuid references public.users(id),
  sort_order int not null default 0, archived_at timestamptz, created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(org_id,key), unique(id,org_id), foreign key(parent_id,org_id) references public.departments(id,org_id),
  check(parent_id is distinct from id)
);
create table public.department_members(
  org_id uuid not null references public.orgs(id) on delete cascade, dept_id uuid not null,
  user_id uuid not null references public.users(id), role text not null default 'member',
  is_primary boolean not null default true, joined_at timestamptz not null default now(),
  primary key(dept_id,user_id), foreign key(dept_id,org_id) references public.departments(id,org_id) on delete cascade
);
create unique index department_members_primary_per_user_idx on public.department_members(org_id,user_id) where is_primary;
create table public.org_department_audit(
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id),
  actor_user_id uuid not null references public.users(id), operation text not null,
  target_dept_id uuid references public.departments(id), target_user_id uuid references public.users(id),
  request_id uuid not null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  unique(actor_user_id,operation,request_id),
  constraint org_department_audit_operation_check check(operation in (
    'department_created','department_moved','department_head_set','department_archived',
    'department_member_assigned','department_member_removed'
  ))
);
create function public.org_department_audit_replay(
  p_operation text,p_request_id uuid,p_org_id uuid,p_metadata jsonb
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.org_department_audit%rowtype;
begin
  if p_request_id is null then raise exception 'request id required' using errcode='22023'; end if;
  select * into v_existing from public.org_department_audit
   where actor_user_id=auth.uid() and operation=p_operation and request_id=p_request_id;
  if not found then return false; end if;
  if v_existing.org_id=p_org_id and v_existing.metadata=p_metadata then return true; end if;
  raise exception 'idempotency key reuse with different request' using errcode='22023';
end $$;
create function public.departments_prevent_cycle() returns trigger language plpgsql as $$
declare v_cursor uuid;
begin
  if new.parent_id is null then return new; end if;
  v_cursor:=new.parent_id;
  while v_cursor is not null loop
    if v_cursor=new.id then raise exception 'department move would create a cycle' using errcode='22023'; end if;
    select parent_id into v_cursor from public.departments where id=v_cursor and org_id=new.org_id;
  end loop;
  return new;
end $$;
create trigger departments_prevent_cycle_trg before insert or update of parent_id on public.departments
for each row execute function public.departments_prevent_cycle();

create table public.companies(id uuid primary key, title text not null);
create table public.items(id uuid primary key, title text not null);
grant usage on schema public,auth to authenticated;
grant execute on function auth.uid() to authenticated;

insert into public.orgs(id) values ('${id.orgA}'),('${id.orgB}');
insert into public.users(id) values
 ('${id.ownerA}'),('${id.adminA}'),('${id.memberA}'),('${id.inactiveA}'),('${id.ownerB}'),('${id.outsider}');
insert into public.org_members(org_id,user_id,role,status) values
 ('${id.orgA}','${id.ownerA}','owner','active'),('${id.orgA}','${id.adminA}','admin','active'),
 ('${id.orgA}','${id.memberA}','member','active'),('${id.orgA}','${id.inactiveA}','member','disabled'),
 ('${id.orgB}','${id.ownerB}','owner','active');
insert into public.departments(id,org_id,name,key,created_by) values
 ('${id.deptA}','${id.orgA}','A 기존','a-existing','${id.ownerA}'),
 ('${id.deptB}','${id.orgB}','B 기존','b-existing','${id.ownerB}');
insert into public.department_members(org_id,dept_id,user_id) values
 ('${id.orgA}','${id.deptA}','${id.memberA}'),('${id.orgB}','${id.deptB}','${id.ownerB}');
insert into public.companies values ('10000000-0000-4000-8000-000000000001','fixture-company');
insert into public.items values ('20000000-0000-4000-8000-000000000001','fixture-item');
`;

const databases: PGlite[] = [];
afterEach(async () => Promise.all(databases.splice(0).map((db) => db.close())));

async function boot() {
  const db = new PGlite();
  databases.push(db);
  await db.exec(SCHEMA);
  const before = await db.query("select (select count(*) from public.departments) departments,(select count(*) from public.department_members) members,(select count(*) from public.companies) companies,(select count(*) from public.items) items");
  await db.exec(migration);
  return { db, before: before.rows[0] };
}

async function as<T = Record<string, unknown>>(db: PGlite, userId: string, sql: string) {
  await db.exec(`reset role; select set_config('app.uid','${userId}',false); set role authenticated;`);
  try {
    return await db.query<T>(sql);
  } finally {
    await db.exec("reset role");
  }
}

describe("#571 부서관리 manager RPC", () => {
  it("migration 자체는 기존 부서·구성원·고객 업무 행을 바꾸지 않는다", async () => {
    const { db, before } = await boot();
    const after = await db.query("select (select count(*) from public.departments) departments,(select count(*) from public.department_members) members,(select count(*) from public.companies) companies,(select count(*) from public.items) items");
    expect(after.rows[0]).toEqual(before);
  });

  it("관리자가 생성→하위→이름변경→최상위 이동→배정·해제를 reload 조회로 유지한다", async () => {
    const { db } = await boot();
    const createRoot = "30000000-0000-4000-8000-000000000001";
    const createChild = "30000000-0000-4000-8000-000000000002";
    await as(db, id.adminA, `select public.manage_org_department_create('${id.orgA}',null,'운영', '${createRoot}')`);
    const root = await db.query<{ id: string }>("select id from public.departments where org_id=$1 and name='운영'", [id.orgA]);
    await as(db, id.adminA, `select public.manage_org_department_create('${id.orgA}','${root.rows[0].id}','심사', '${createChild}')`);
    const child = await db.query<{ id: string }>("select id from public.departments where org_id=$1 and name='심사'", [id.orgA]);
    await as(db, id.adminA, `select public.manage_org_department_rename('${id.orgA}','${child.rows[0].id}','실행','30000000-0000-4000-8000-000000000003')`);
    await as(db, id.adminA, `select public.manage_org_department_move('${id.orgA}','${child.rows[0].id}',null,'30000000-0000-4000-8000-000000000004')`);
    await as(db, id.adminA, `select public.manage_org_department_member('${id.orgA}','${id.memberA}','${child.rows[0].id}','30000000-0000-4000-8000-000000000005')`);
    expect((await db.query("select name,parent_id from public.departments where id=$1", [child.rows[0].id])).rows).toEqual([{ name: "실행", parent_id: null }]);
    expect((await db.query("select dept_id,user_id from public.department_members where org_id=$1 and user_id=$2", [id.orgA, id.memberA])).rows).toEqual([{ dept_id: child.rows[0].id, user_id: id.memberA }]);
    await as(db, id.adminA, `select public.manage_org_department_member('${id.orgA}','${id.memberA}',null,'30000000-0000-4000-8000-000000000006')`);
    expect((await db.query("select 1 from public.department_members where org_id=$1 and user_id=$2 and is_primary", [id.orgA, id.memberA])).rows).toEqual([]);
    expect((await db.query("select operation from public.org_department_audit where actor_user_id=$1 order by created_at,id", [id.adminA])).rows).toHaveLength(6);
  });

  it("owner와 admin만 쓰고 member·외부인·비활성 대상·타조직 참조는 변화0으로 거부한다", async () => {
    const { db } = await boot();
    await as(db, id.ownerA, `select public.manage_org_department_rename('${id.orgA}','${id.deptA}','대표 변경','40000000-0000-4000-8000-000000000001')`);
    await expect(as(db, id.memberA, `select public.manage_org_department_create('${id.orgA}',null,'금지','40000000-0000-4000-8000-000000000002')`)).rejects.toThrow(/manager required/iu);
    await expect(as(db, id.outsider, `select public.manage_org_department_create('${id.orgA}',null,'금지','40000000-0000-4000-8000-000000000003')`)).rejects.toThrow(/manager required/iu);
    await expect(as(db, id.adminA, `select public.manage_org_department_member('${id.orgA}','${id.inactiveA}','${id.deptA}','40000000-0000-4000-8000-000000000004')`)).rejects.toThrow(/active member/iu);
    await expect(as(db, id.adminA, `select public.manage_org_department_move('${id.orgA}','${id.deptA}','${id.deptB}','40000000-0000-4000-8000-000000000005')`)).rejects.toThrow(/parent department/iu);
    expect((await db.query("select name,parent_id from public.departments where id=$1", [id.deptA])).rows).toEqual([{ name: "대표 변경", parent_id: null }]);
    expect((await db.query("select name,parent_id from public.departments where id=$1", [id.deptB])).rows).toEqual([{ name: "B 기존", parent_id: null }]);
  });

  it("같은 request는 행을 한 번만 만들고 payload가 다르면 거부한다", async () => {
    const { db } = await boot();
    const request = "50000000-0000-4000-8000-000000000001";
    await as(db, id.adminA, `select public.manage_org_department_create('${id.orgA}',null,'재실행','${request}')`);
    await as(db, id.adminA, `select public.manage_org_department_create('${id.orgA}',null,'재실행','${request}')`);
    expect((await db.query("select 1 from public.departments where org_id=$1 and name='재실행'", [id.orgA])).rows).toHaveLength(1);
    await expect(as(db, id.adminA, `select public.manage_org_department_create('${id.orgA}',null,'다른 값','${request}')`)).rejects.toThrow(/idempotency key reuse/iu);
  });
});
