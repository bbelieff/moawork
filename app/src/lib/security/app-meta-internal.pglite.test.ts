import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/136_issue620_app_meta_internal.sql"),
  "utf8",
);

const roles = ["public_probe", "anon", "authenticated", "service_role"] as const;
const privileges = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"] as const;
const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

const preState = `
create role public_probe nologin;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create table public.migration_apply_guard(
  logical_key text primary key,
  file_name text,
  file_digest text,
  expected_predecessor text,
  executor text,
  thread_id text,
  applied_at bigint generated always as identity
);
insert into public.migration_apply_guard(
  logical_key,file_name,file_digest,expected_predecessor,executor,thread_id
) values (
  '135_issue599_assignment_ui_hardening',
  '135_issue599_assignment_ui_hardening.sql',
  '${"3e4ba856cc5fdd677f2e24809c697e54da09e61f029dd88de683e6af70f19425"}',
  '134_issue599_assignment_lineage_core',
  'test',
  'issue620'
);

create function public.begin_guarded_migration(
  p_logical_key text,
  p_file_name text,
  p_file_digest text,
  p_expected_predecessor text,
  p_executor text,
  p_thread_id text,
  p_foundation boolean
) returns void
language plpgsql
as $$
declare
  v_frontier text;
begin
  if exists (
    select 1 from public.migration_apply_guard where logical_key = p_logical_key
  ) then
    raise exception 'migration logical key already applied' using errcode = '23505';
  end if;

  select logical_key into v_frontier
    from public.migration_apply_guard
   order by applied_at desc
   limit 1;

  if v_frontier is distinct from p_expected_predecessor then
    raise exception 'migration predecessor mismatch';
  end if;

  insert into public.migration_apply_guard(
    logical_key,file_name,file_digest,expected_predecessor,executor,thread_id
  ) values (
    p_logical_key,p_file_name,p_file_digest,p_expected_predecessor,p_executor,p_thread_id
  );
end;
$$;

create table public.app_meta (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
insert into public.app_meta(key,value)
values('schema_version','0001')
on conflict(key) do update set value=excluded.value,updated_at=now();
insert into public.app_meta(key,value)
values('schema_version','019')
on conflict(key) do update set value=excluded.value,updated_at=now();
insert into public.app_meta(key,value)
values('schema_version','064')
on conflict(key) do update set value=excluded.value,updated_at=now();

grant all on table public.app_meta to public, anon, authenticated, service_role;

create table public.issue620_unrelated(id integer primary key, note text not null);
insert into public.issue620_unrelated values(1,'unchanged');
grant select on table public.issue620_unrelated to anon;
grant insert, update, delete on table public.issue620_unrelated to authenticated;
`;

async function boot(sql = migration) {
  const db = new PGlite();
  databases.push(db);
  await db.exec(preState);
  if (sql) await db.exec(sql);
  return db;
}

function canonicalDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function appMetaSnapshot(db: PGlite) {
  const rows = (
    await db.query("select key,value,updated_at from public.app_meta order by key")
  ).rows;
  const columns = (
    await db.query(`select column_name,data_type,is_nullable,column_default,ordinal_position
      from information_schema.columns
      where table_schema='public' and table_name='app_meta'
      order by ordinal_position`)
  ).rows;
  return { count: rows.length, digest: canonicalDigest(rows), columns };
}

async function unrelatedSnapshot(db: PGlite) {
  return (
    await db.query(`select c.relacl::text acl,c.relrowsecurity rls,c.relforcerowsecurity force_rls,
      (select count(*)::int from public.issue620_unrelated) row_count,
      (select md5(string_agg(id::text || ':' || note, ',' order by id)) from public.issue620_unrelated) row_digest
      from pg_class c where c.oid='public.issue620_unrelated'::regclass`)
  ).rows[0];
}

async function privilegeMatrix(db: PGlite) {
  const result: Record<string, Record<string, boolean>> = {};
  for (const role of roles) {
    result[role] = {};
    for (const privilege of privileges) {
      result[role][privilege] = (
        await db.query<{ allowed: boolean }>(
          `select has_table_privilege($1,'public.app_meta',$2) allowed`,
          [role, privilege],
        )
      ).rows[0].allowed;
    }
  }
  return result;
}

async function queryAs(db: PGlite, role: string, sql: string) {
  await db.exec(`set role ${role}`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec("reset role");
  }
}

async function expectRoleDenied(db: PGlite, role: string) {
  const statements = [
    "select * from public.app_meta",
    "insert into public.app_meta(key,value) values('blocked','blocked')",
    "update public.app_meta set value='blocked' where key='schema_version'",
    "delete from public.app_meta where key='schema_version'",
    "truncate table public.app_meta",
  ];
  for (const sql of statements) {
    await expect(queryAs(db, role, sql)).rejects.toThrow(/permission denied/iu);
  }
}

describe("#620 migration 136 app_meta internalization", () => {
  it("starts from the reproduced legacy exposure, including inherited PUBLIC access", async () => {
    const db = await boot("");
    const matrix = await privilegeMatrix(db);
    for (const role of roles) {
      expect(matrix[role]).toEqual(Object.fromEntries(privileges.map((privilege) => [privilege, true])));
    }
    expect((await queryAs(db, "anon", "select count(*)::int count from public.app_meta")).rows[0]).toEqual({ count: 1 });
  });

  it("revokes every external table operation and leaves zero policies behind FORCE RLS", async () => {
    const db = await boot();
    const matrix = await privilegeMatrix(db);
    for (const role of roles) {
      expect(matrix[role]).toEqual(Object.fromEntries(privileges.map((privilege) => [privilege, false])));
      await expectRoleDenied(db, role);
    }

    expect(
      (
        await db.query(`select c.relowner::regrole::text owner,c.relrowsecurity rls,c.relforcerowsecurity force_rls,
          (select count(*)::int from pg_policy where polrelid=c.oid) policy_count,
          (select count(*)::int from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl where acl.grantee=0) public_acl_count
          from pg_class c where c.oid='public.app_meta'::regclass`)
      ).rows[0],
    ).toEqual({ owner: "postgres", rls: true, force_rls: true, policy_count: 0, public_acl_count: 0 });
  });

  it("preserves the exact app_meta row/schema digest and every unrelated table property", async () => {
    const db = await boot("");
    const appMetaBefore = await appMetaSnapshot(db);
    const unrelatedBefore = await unrelatedSnapshot(db);
    await db.exec(migration);
    expect(await appMetaSnapshot(db)).toEqual(appMetaBefore);
    expect(await unrelatedSnapshot(db)).toEqual(unrelatedBefore);
  });

  it("records the exact guarded frontier and rejects replay without a second receipt", async () => {
    const db = await boot();
    expect(
      (
        await db.query(`select logical_key,file_name,file_digest,expected_predecessor
          from public.migration_apply_guard order by applied_at desc limit 1`)
      ).rows[0],
    ).toEqual({
      logical_key: "136_issue620_app_meta_internal",
      file_name: "136_issue620_app_meta_internal.sql",
      file_digest: migration.match(/p_file_digest\s*=>\s*'([0-9a-f]{64})'/u)?.[1],
      expected_predecessor: "135_issue599_assignment_ui_hardening",
    });
    await expect(db.exec(migration)).rejects.toThrow(/already applied/iu);
    expect(
      (
        await db.query("select count(*)::int count from public.migration_apply_guard where logical_key='136_issue620_app_meta_internal'")
      ).rows[0],
    ).toEqual({ count: 1 });
  });

  it("contains no app_meta row/schema rewrite or global default privilege change", () => {
    expect(migration).not.toMatch(/\b(insert\s+into|update|delete\s+from)\s+public\.app_meta\b/iu);
    expect(migration).not.toMatch(/\bdrop\s+table\b|\brename\s+to\b|\bset\s+schema\b/iu);
    expect(migration).not.toMatch(/\balter\s+default\s+privileges\b/iu);
  });

  it("turns RED if either the ACL revoke or FORCE RLS guard is removed", async () => {
    const withoutRevoke = migration.replace(
      "revoke all on table public.app_meta from public, anon, authenticated, service_role;",
      "-- mutation: revoke removed",
    );
    const revokeDb = new PGlite();
    databases.push(revokeDb);
    await revokeDb.exec(preState);
    await expect(revokeDb.exec(withoutRevoke)).rejects.toThrow(/unsafe_issue620_app_meta_acl/iu);

    const withoutForce = migration.replace(
      "alter table public.app_meta force row level security;",
      "-- mutation: force RLS removed",
    );
    const forceDb = new PGlite();
    databases.push(forceDb);
    await forceDb.exec(preState);
    await expect(forceDb.exec(withoutForce)).rejects.toThrow(/unsafe_issue620_app_meta_rls/iu);
  });
});
