import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dependencyRoot = process.env.PGLITE_MODULE_ROOT ?? root;
const { PGlite } = await import(
  pathToFileURL(path.join(dependencyRoot, "node_modules", "@electric-sql", "pglite", "dist", "index.js")).href
);
const migration = (name) => readFile(path.join(root, "supabase", "migrations", name), "utf8");

const ids = {
  orgA: "10000000-0000-4000-8000-0000000000a1",
  orgB: "10000000-0000-4000-8000-0000000000b1",
  ownerA: "20000000-0000-4000-8000-0000000000a1",
  adminA: "20000000-0000-4000-8000-0000000000a2",
  memberA: "20000000-0000-4000-8000-0000000000a3",
  leadA: "20000000-0000-4000-8000-0000000000a4",
  ownerB: "20000000-0000-4000-8000-0000000000b1",
};

const pathA = `${ids.orgA}/logo.png`;
const pathB = `${ids.orgB}/logo.png`;

async function actor(db, userId) {
  await db.exec("reset role");
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', false)`);
  await db.exec("set role authenticated");
}

async function asPostgres(db) {
  await db.exec("reset role");
  await db.exec("select set_config('request.jwt.claim.sub', '', false)");
}

/**
 * 098 을 적용할 수 있는 최소 환경.
 *
 * ★ 여기서 «095 의 원장 row 만 직접 넣는» 지름길을 쓴다.
 *   094 의 predecessor 검사가 원장 row 존재 확인이기 때문에(094:60-66),
 *   095 의 무거운 의존(items·boards·deals)을 전부 스텁하지 않아도 098 을 실행할 수 있다.
 *   ★★ 이것은 «테스트만의» 지름길이다. 운영 적용 절차가 아니다.
 *      운영에서는 095 를 실제로 적용해야 원장 row 가 생긴다.
 */
async function bootstrap(db, { withStorage = true } = {}) {
  await db.exec(`
    create schema auth;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create type public.member_role as enum ('owner','admin','team_lead','member');
    create type public.member_scope as enum ('all','department','assigned');

    create table public.orgs(
      id uuid primary key,
      name text not null,
      plan_tier text not null default 't1_3',
      status text not null default 'active'
    );
    create table public.users(id uuid primary key);
    create table public.org_members(
      org_id uuid not null references public.orgs(id),
      user_id uuid not null references public.users(id),
      role public.member_role not null,
      scope public.member_scope not null default 'all',
      status text not null default 'active',
      primary key(org_id,user_id)
    );

    create function public.is_org_member(p_org uuid) returns boolean
      language sql stable security definer set search_path = public, pg_temp as $$
      select exists (
        select 1 from public.org_members m join public.orgs o on o.id = m.org_id
        where m.org_id = p_org and m.user_id = auth.uid()
          and m.status = 'active' and o.status = 'active'
      );
    $$;
    create function public.org_role(p_org uuid) returns public.member_role
      language sql stable security definer set search_path = public, pg_temp as $$
      select m.role from public.org_members m join public.orgs o on o.id = m.org_id
      where m.org_id = p_org and m.user_id = auth.uid()
        and m.status = 'active' and o.status = 'active';
    $$;

    -- 006_public_workspace_entry.sql:1085-1094 의 잠금을 그대로 재현한다.
    -- 클라이언트는 orgs 를 직접 쓸 수 없다. RPC 가 유일한 문이라는 것을 이 테스트가 실제로 잰다.
    alter table public.orgs enable row level security;
    create policy orgs_select on public.orgs for select using (public.is_org_member(id));
    grant usage on schema public, auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    grant execute on function public.is_org_member(uuid) to authenticated;
    grant execute on function public.org_role(uuid) to authenticated;
    grant select on public.orgs to authenticated;
    revoke insert, update, delete on public.orgs from public, anon, authenticated;
  `);

  if (withStorage) {
    await db.exec(`
      create schema storage;
      create table storage.buckets(
        id text primary key, name text not null, public boolean not null default false,
        file_size_limit bigint, allowed_mime_types text[]
      );
      create table storage.objects(
        id uuid primary key default gen_random_uuid(),
        bucket_id text not null references storage.buckets(id),
        name text not null, owner uuid
      );
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated;
      grant select, insert, update, delete on storage.objects to authenticated;
      grant select on storage.buckets to authenticated;
    `);
  }

  // 로고와 무관한 «기존 데이터». 마이그레이션이 이것을 건드리면 안 된다.
  await db.exec(`
    insert into public.orgs(id,name,plan_tier) values
      ('${ids.orgA}','회사 가','t1_3'), ('${ids.orgB}','회사 나','t2_10');
    insert into public.users(id) values
      ('${ids.ownerA}'),('${ids.adminA}'),('${ids.memberA}'),('${ids.leadA}'),('${ids.ownerB}');
    insert into public.org_members(org_id,user_id,role) values
      ('${ids.orgA}','${ids.ownerA}','owner'),
      ('${ids.orgA}','${ids.adminA}','admin'),
      ('${ids.orgA}','${ids.memberA}','member'),
      ('${ids.orgA}','${ids.leadA}','team_lead'),
      ('${ids.orgB}','${ids.ownerB}','owner');
  `);

  await db.exec(await migration("094_migration_apply_guard.sql"));
  await db.exec(`
    insert into public.migration_apply_guard
      (logical_key, file_name, file_digest, expected_predecessor, executor, thread_id)
    values (
      '095_bbe172_new_lead_contact_transition',
      '095_bbe172_new_lead_contact_transition.sql',
      repeat('0', 64),
      '094_migration_apply_guard',
      'test-shortcut',
      'test-shortcut'
    );
  `);
  await db.exec(await migration("098_bbe199_org_logo.sql"));
}

test("098 은 additive 다 — 기존 row 를 건드리지 않고 로고 칸만 비어 있다", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    const rows = (await db.query(
      "select id, name, plan_tier, logo_path, logo_mime, logo_bytes, logo_updated_at, logo_updated_by from public.orgs order by name",
    )).rows;
    assert.deepEqual(rows, [
      { id: ids.orgA, name: "회사 가", plan_tier: "t1_3", logo_path: null, logo_mime: null, logo_bytes: null, logo_updated_at: null, logo_updated_by: null },
      { id: ids.orgB, name: "회사 나", plan_tier: "t2_10", logo_path: null, logo_mime: null, logo_bytes: null, logo_updated_at: null, logo_updated_by: null },
    ]);
    assert.equal((await db.query("select count(*)::integer c from public.org_logo_audit")).rows[0].c, 0);
  } finally {
    await db.close();
  }
});

test("098 을 두 번 적용하면 가드가 막는다", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    await assert.rejects(
      db.exec(await migration("098_bbe199_org_logo.sql")),
      /migration logical key already applied/,
    );
  } finally {
    await db.close();
  }
});

test("orgs 직접 UPDATE 는 여전히 막혀 있다 — RPC 가 유일한 문이다", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    await actor(db, ids.ownerA);
    // owner 라도 orgs 를 직접 쓸 수 없다. 열렸다면 plan_tier 까지 열린 것이다.
    await assert.rejects(
      db.query(`update public.orgs set logo_path = '${pathA}' where id = '${ids.orgA}'`),
      /permission denied/i,
    );
    await assert.rejects(
      db.query(`update public.orgs set plan_tier = 't5_50' where id = '${ids.orgA}'`),
      /permission denied/i,
    );
  } finally {
    await db.close();
  }
});

test("owner/admin 은 로고를 올리고 지운다 · 감사가 남는다", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);

    await actor(db, ids.ownerA);
    const set = (await db.query(
      `select * from public.set_org_logo('${ids.orgA}','${pathA}','image/png',2048)`,
    )).rows[0];
    assert.equal(set.logo_path, pathA);
    assert.equal(set.logo_mime, "image/png");
    assert.equal(set.logo_bytes, 2048);
    assert.notEqual(set.logo_updated_at, null);

    await asPostgres(db);
    const stored = (await db.query(
      `select logo_path, logo_mime, logo_bytes, logo_updated_by from public.orgs where id = '${ids.orgA}'`,
    )).rows[0];
    assert.deepEqual(stored, { logo_path: pathA, logo_mime: "image/png", logo_bytes: 2048, logo_updated_by: ids.ownerA });
    // 다른 조직은 그대로다.
    assert.equal((await db.query(`select logo_path from public.orgs where id = '${ids.orgB}'`)).rows[0].logo_path, null);

    // admin 도 바꿀 수 있다.
    await actor(db, ids.adminA);
    await db.query(`select * from public.set_org_logo('${ids.orgA}','${ids.orgA}/logo.svg','image/svg+xml',900)`);

    // admin 이 지운다.
    const cleared = (await db.query(`select * from public.clear_org_logo('${ids.orgA}')`)).rows[0];
    assert.deepEqual(
      { logo_path: cleared.logo_path, logo_mime: cleared.logo_mime, logo_bytes: cleared.logo_bytes },
      { logo_path: null, logo_mime: null, logo_bytes: null },
    );

    await asPostgres(db);
    const audit = (await db.query(
      "select org_id, actor_id, action, logo_path, logo_mime, logo_bytes from public.org_logo_audit order by created_at",
    )).rows;
    assert.deepEqual(audit, [
      { org_id: ids.orgA, actor_id: ids.ownerA, action: "set", logo_path: pathA, logo_mime: "image/png", logo_bytes: 2048 },
      { org_id: ids.orgA, actor_id: ids.adminA, action: "set", logo_path: `${ids.orgA}/logo.svg`, logo_mime: "image/svg+xml", logo_bytes: 900 },
      { org_id: ids.orgA, actor_id: ids.adminA, action: "clear", logo_path: `${ids.orgA}/logo.svg`, logo_mime: null, logo_bytes: null },
    ]);
  } finally {
    await db.close();
  }
});

test("member·team_lead·비회원·비로그인은 거부된다 (42501)", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);

    for (const [who, id] of [["member", ids.memberA], ["team_lead", ids.leadA]]) {
      await actor(db, id);
      await assert.rejects(
        db.query(`select * from public.set_org_logo('${ids.orgA}','${pathA}','image/png',2048)`),
        (error) => { assert.match(error.message, /org logo denied/, who); return true; },
      );
      await assert.rejects(
        db.query(`select * from public.clear_org_logo('${ids.orgA}')`),
        /org logo denied/,
      );
    }

    // 다른 조직의 owner 는 이 조직에서 아무것도 아니다.
    await actor(db, ids.ownerB);
    await assert.rejects(
      db.query(`select * from public.set_org_logo('${ids.orgA}','${pathA}','image/png',2048)`),
      /org logo denied/,
    );

    // 로그인하지 않은 상태.
    await db.exec("reset role");
    await db.exec("select set_config('request.jwt.claim.sub', '', false)");
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query(`select * from public.set_org_logo('${ids.orgA}','${pathA}','image/png',2048)`),
      /org logo denied/,
    );

    await asPostgres(db);
    assert.equal((await db.query("select count(*)::integer c from public.org_logo_audit")).rows[0].c, 0);
    assert.equal((await db.query(`select logo_path from public.orgs where id = '${ids.orgA}'`)).rows[0].logo_path, null);
  } finally {
    await db.close();
  }
});

test("★ 남의 조직 경로를 자기 조직 로고로 저장할 수 없다 — 정당한 owner 라도", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    await actor(db, ids.ownerA);
    // orgA 의 owner 는 orgA 에 대한 권한이 있다. 그러나 경로가 orgB 다.
    // 막지 않으면 서버가 발급하는 signed URL 을 타고 남의 파일을 읽게 된다.
    await assert.rejects(
      db.query(`select * from public.set_org_logo('${ids.orgA}','${pathB}','image/png',2048)`),
      /org logo path rejected/,
    );
    for (const bad of [
      "logo.png",
      "../" + ids.orgA + "/logo.png",
      ids.orgA,
      `${ids.orgA}/sub/logo.png`,
      "not-a-uuid/logo.png",
      `${ids.orgA}/../${ids.orgB}/logo.png`,
      `${ids.orgA}/a/../../${ids.orgB}/logo.png`,
      `${ids.orgA}/..`,
      `${ids.orgA}/.`,
    ]) {
      await assert.rejects(
        db.query(`select * from public.set_org_logo('${ids.orgA}',$1,'image/png',2048)`, [bad]),
        /org logo path rejected/,
        `허용되면 안 되는 경로: ${bad}`,
      );
    }
    await asPostgres(db);
    assert.equal((await db.query(`select logo_path from public.orgs where id = '${ids.orgA}'`)).rows[0].logo_path, null);
  } finally {
    await db.close();
  }
});

test("★ 3겹째(DB CHECK)가 «혼자서도» 경로 탈출을 막는다 — RPC 를 우회해도", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    await asPostgres(db);
    // RPC(2겹)를 통째로 건너뛰고 postgres 로 직접 쓴다.
    // 3겹이 2겹보다 약하면 여기서 저장돼 버린다 (DC-16 이 실제로 뚫은 경로들).
    for (const bad of [
      `${ids.orgB}/logo.png`,
      `${ids.orgA}/../${ids.orgB}/logo.png`,
      `${ids.orgA}/a/../../${ids.orgB}/logo.png`,
      `${ids.orgA}/sub/logo.png`,
      `${ids.orgA}/..`,
      `${ids.orgA}/.`,
      "logo.png",
    ]) {
      await assert.rejects(
        db.query(
          `update public.orgs set logo_path = $1, logo_mime = 'image/png', logo_bytes = 10 where id = '${ids.orgA}'`,
          [bad],
        ),
        /orgs_logo_path_org_scoped/,
        `DB CHECK 가 통과시키면 안 되는 경로: ${bad}`,
      );
    }
    // 정상 경로는 통과한다.
    await db.query(
      `update public.orgs set logo_path = $1, logo_mime = 'image/png', logo_bytes = 10 where id = '${ids.orgA}'`,
      [pathA],
    );
    assert.equal((await db.query(`select logo_path from public.orgs where id = '${ids.orgA}'`)).rows[0].logo_path, pathA);
  } finally {
    await db.close();
  }
});

test("★ 용량·형식을 RPC 가 각각 다른 사유로 거부한다", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    await actor(db, ids.ownerA);

    // 형식 불가 — 용량은 정상.
    for (const mime of ["image/gif", "text/html", "application/pdf", "image/png; charset=utf-8"]) {
      await assert.rejects(
        db.query(`select * from public.set_org_logo('${ids.orgA}','${pathA}',$1,2048)`, [mime]),
        /org logo format rejected/,
        mime,
      );
    }
    await assert.rejects(
      db.query(`select * from public.set_org_logo('${ids.orgA}','${pathA}',null,2048)`),
      /org logo format rejected/,
    );

    // 용량 초과 — 형식은 정상. 1 MiB 경계를 실제로 잰다.
    await assert.rejects(
      db.query(`select * from public.set_org_logo('${ids.orgA}','${pathA}','image/png',1048577)`),
      /org logo size rejected/,
    );
    await assert.rejects(
      db.query(`select * from public.set_org_logo('${ids.orgA}','${pathA}','image/png',0)`),
      /org logo size rejected/,
    );

    // 경계값 정확히 1 MiB 는 통과한다.
    const ok = (await db.query(`select * from public.set_org_logo('${ids.orgA}','${pathA}','image/png',1048576)`)).rows[0];
    assert.equal(ok.logo_bytes, 1048576);
  } finally {
    await db.close();
  }
});

test("★ 감사 행이 안 남으면 로고도 안 바뀐다 (같은 트랜잭션)", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    await asPostgres(db);
    // 감사 insert 를 실패하게 만든다.
    await db.exec("alter table public.org_logo_audit add constraint tmp_block_set check (action <> 'set')");

    await actor(db, ids.ownerA);
    await assert.rejects(
      db.query(`select * from public.set_org_logo('${ids.orgA}','${pathA}','image/png',2048)`),
      /tmp_block_set/,
    );

    await asPostgres(db);
    // 감사가 실패했으므로 orgs 도 롤백되어 있어야 한다.
    assert.equal((await db.query(`select logo_path from public.orgs where id = '${ids.orgA}'`)).rows[0].logo_path, null);
    assert.equal((await db.query("select count(*)::integer c from public.org_logo_audit")).rows[0].c, 0);
  } finally {
    await db.close();
  }
});

test("감사는 owner/admin 만 읽고, 남의 조직 것은 0행이다", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    await actor(db, ids.ownerA);
    await db.query(`select * from public.set_org_logo('${ids.orgA}','${pathA}','image/png',2048)`);
    assert.equal((await db.query("select count(*)::integer c from public.org_logo_audit")).rows[0].c, 1);

    await actor(db, ids.adminA);
    assert.equal((await db.query("select count(*)::integer c from public.org_logo_audit")).rows[0].c, 1);

    await actor(db, ids.memberA);
    assert.equal((await db.query("select count(*)::integer c from public.org_logo_audit")).rows[0].c, 0);

    await actor(db, ids.ownerB);
    assert.equal((await db.query("select count(*)::integer c from public.org_logo_audit")).rows[0].c, 0);
  } finally {
    await db.close();
  }
});

test("함수 ACL — anon·service_role 은 실행할 수 없다", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    await asPostgres(db);
    for (const signature of [
      "public.set_org_logo(uuid,text,text,integer)",
      "public.clear_org_logo(uuid)",
    ]) {
      const row = (await db.query(
        `select has_function_privilege('public',$1,'execute') pub,
                has_function_privilege('anon',$1,'execute') anon,
                has_function_privilege('service_role',$1,'execute') svc,
                has_function_privilege('authenticated',$1,'execute') auth`,
        [signature],
      )).rows[0];
      assert.deepEqual(row, { pub: false, anon: false, svc: false, auth: true }, signature);
    }
    const installed = (await db.query(
      "select has_function_privilege('authenticated','public.org_logo_storage_installed()','execute') auth",
    )).rows[0];
    assert.equal(installed.auth, false);
  } finally {
    await db.close();
  }
});

test("★ Storage — 버킷은 비공개이고 용량·형식을 서버가 강제한다", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    await asPostgres(db);
    const bucket = (await db.query(
      "select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'org-logos'",
    )).rows[0];
    assert.equal(bucket.public, false, "공개 버킷이면 «타 조직 읽기 0» 을 RLS 로 만들 수 없다");
    assert.equal(Number(bucket.file_size_limit), 1048576);
    assert.deepEqual(bucket.allowed_mime_types, ["image/png", "image/jpeg", "image/svg+xml"]);
    assert.equal((await db.query("select public.org_logo_storage_installed() ok")).rows[0].ok, true);
  } finally {
    await db.close();
  }
});

test("★ Storage RLS — 남의 조직 로고를 읽지도 덮어쓰지도 못한다", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    await asPostgres(db);
    await db.exec(`
      insert into storage.objects(bucket_id,name) values ('org-logos','${pathA}'), ('org-logos','${pathB}');
    `);

    // orgA 회원은 orgA 것만 본다.
    for (const id of [ids.ownerA, ids.adminA, ids.memberA]) {
      await actor(db, id);
      const names = (await db.query("select name from storage.objects order by name")).rows.map((r) => r.name);
      assert.deepEqual(names, [pathA], `조직 경계 위반: ${id}`);
    }

    // orgB 의 owner 는 orgB 것만 본다.
    await actor(db, ids.ownerB);
    assert.deepEqual((await db.query("select name from storage.objects order by name")).rows.map((r) => r.name), [pathB]);

    // orgA 의 owner 가 orgB 폴더에 쓰려 하면 막힌다.
    await actor(db, ids.ownerA);
    await assert.rejects(
      db.query(`insert into storage.objects(bucket_id,name) values ('org-logos','${ids.orgB}/steal.png')`),
      /row-level security/i,
    );
    // 남의 것을 지우지도 못한다 — 보이지 않으므로 0행이 지워진다.
    await db.query(`delete from storage.objects where name = '${pathB}'`);
    await asPostgres(db);
    assert.equal(
      (await db.query(`select count(*)::integer c from storage.objects where name = '${pathB}'`)).rows[0].c,
      1,
      "남의 조직 오브젝트가 지워졌다",
    );
  } finally {
    await db.close();
  }
});

test("★ Storage RLS — member 는 올리지 못하고 owner/admin 은 올린다", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);

    await actor(db, ids.memberA);
    await assert.rejects(
      db.query(`insert into storage.objects(bucket_id,name) values ('org-logos','${pathA}')`),
      /row-level security/i,
    );
    await actor(db, ids.leadA);
    await assert.rejects(
      db.query(`insert into storage.objects(bucket_id,name) values ('org-logos','${pathA}')`),
      /row-level security/i,
    );

    await actor(db, ids.ownerA);
    await db.query(`insert into storage.objects(bucket_id,name) values ('org-logos','${pathA}')`);
    await actor(db, ids.adminA);
    await db.query(`insert into storage.objects(bucket_id,name) values ('org-logos','${ids.orgA}/logo2.png')`);

    // uuid 폴더가 아닌 경로는 org 를 해석할 수 없으므로 누구도 못 쓴다.
    await actor(db, ids.ownerA);
    await assert.rejects(
      db.query("insert into storage.objects(bucket_id,name) values ('org-logos','logo.png')"),
      /row-level security/i,
    );
  } finally {
    await db.close();
  }
});

test("storage 스키마가 없으면 건너뛰되 조용히 넘어가지 않는다", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db, { withStorage: false });
    await asPostgres(db);
    // 함수 생성 자체는 성공해야 한다 (본문이 동적 SQL 이므로).
    assert.equal((await db.query("select public.org_logo_storage_installed() ok")).rows[0].ok, false);
    // 그래도 DB 층의 방어는 살아 있다.
    await actor(db, ids.ownerA);
    await assert.rejects(
      db.query(`select * from public.set_org_logo('${ids.orgA}','${pathB}','image/png',2048)`),
      /org logo path rejected/,
    );
  } finally {
    await db.close();
  }
});
