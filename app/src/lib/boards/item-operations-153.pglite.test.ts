import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 153_item_operations_draft PGlite 검증 (초안 SQL의 원자성·권한 단위 검증).
 *
 * 실제 역할 권한(GRANT success / revoke 거부 / outsider 거부·무부수효과),
 * auth-first receipt (actor 바인딩·payload 불일치 22023·lost-response replay),
 * 상하위 그래프 직렬화·전체 순환 검출·부모 가시성,
 * 정본 딜 원자 복제(회사 유지·새 deal·출처 한 트랜잭션)를 다룬다.
 * UI/action/service 검증은 TS 측 테스트에서 다룬다.
 */

const ids = {
  org: "00000000-0000-4000-8000-000000000001",
  other: "00000000-0000-4000-8000-000000000002",
  actor: "00000000-0000-4000-8000-000000000010",
  member2: "00000000-0000-4000-8000-000000000012",
  outsider: "00000000-0000-4000-8000-000000000011",
  board: "00000000-0000-4000-8000-000000000020",
  otherBoard: "00000000-0000-4000-8000-000000000021",
  canonicalBoard: "00000000-0000-4000-8000-000000000022",
  contractBoard: "00000000-0000-4000-8000-000000000023",
  g1: "00000000-0000-4000-8000-000000000030",
  gNl: "00000000-0000-4000-8000-000000000031",
  gCw: "00000000-0000-4000-8000-000000000032",
  a: "00000000-0000-4000-8000-000000000040",
  b: "00000000-0000-4000-8000-000000000041",
  c: "00000000-0000-4000-8000-000000000042",
  foreign: "00000000-0000-4000-8000-000000000043",
  dup: "00000000-0000-4000-8000-000000000044",
  company: "00000000-0000-4000-8000-000000000050",
  deal: "00000000-0000-4000-8000-000000000051",
  dealItem: "00000000-0000-4000-8000-000000000052",
};
const request = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let db: PGlite;
let migrationSql = "";

async function asActor<T>(actor: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set app.actor='${actor}'`);
  try {
    return await fn();
  } finally {
    await db.exec(`set app.actor='${ids.actor}'`);
  }
}

/** 실제 authenticated 역할로 실행한다 (GRANT 경로 검증). */
async function asRole<T>(role: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role`);
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role bootstrap_tmp superuser;
    set session authorization bootstrap_tmp;
    alter role postgres rename to supabase_admin;
    set session authorization supabase_admin;
    create role postgres nologin noinherit createrole bypassrls;
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    grant usage,create on schema public,auth to postgres with grant option;
    grant anon,authenticated,service_role to postgres with admin true,set true,inherit true;
    set session authorization postgres;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.actor',true),'')::uuid$$;
    create function public.begin_guarded_migration(p_logical_key text,p_file_name text,p_file_digest text,p_expected_predecessor text,p_executor text,p_thread_id text,p_foundation boolean) returns void language sql as $$select$$;
    create table public.orgs(id uuid primary key,status text not null default 'active');
    create table public.users(id uuid primary key);
    create table public.org_members(org_id uuid,user_id uuid,status text,role text,scope text,primary key(org_id,user_id));
    create table public.boards(id uuid primary key,org_id uuid not null references public.orgs(id),source text,is_system boolean not null default false,updated_at timestamptz default now());
    create table public.board_groups(id uuid primary key,org_id uuid not null,board_id uuid not null references public.boards(id),name text default 'group',sort_order integer not null default 0);
    create table public.companies(id uuid primary key default gen_random_uuid(),org_id uuid not null references public.orgs(id),name text not null);
    create table public.deals(id uuid primary key default gen_random_uuid(),org_id uuid not null references public.orgs(id),company_id uuid references public.companies(id),pipeline_id uuid,stage_id uuid,assigned_to uuid,title text not null);
    create table public.deal_intake(deal_id uuid primary key,org_id uuid not null references public.orgs(id),representative_name text,phone_normalized text,phone_display text,email_normalized text,business_registration_type text,industry text,industry_code text,revenue_band text,region_sido text,region_sigungu text,acquisition_source text,source_external_id text);
    create table public.board_columns(id uuid primary key default gen_random_uuid(),org_id uuid not null,board_id uuid not null references public.boards(id),key text not null,type text not null default 'text',source text not null default 'in',is_readonly boolean not null default false,sort_order integer not null default 0,unique(board_id,key));
    create table public.items(id uuid primary key,org_id uuid not null,board_id uuid not null references public.boards(id),group_id uuid,title text not null,assigned_to uuid,deal_id uuid references public.deals(id),sort_order integer not null default 0,parent_item_id uuid,deleted_at timestamptz,deleted_by uuid,archived_at timestamptz,archived_by uuid,created_at timestamptz default now(),updated_at timestamptz default now());
    create table public.item_values(org_id uuid not null,item_id uuid not null references public.items(id) on delete cascade,column_key text not null,value_jsonb jsonb,primary key(item_id,column_key));
    insert into public.orgs(id) values('${ids.org}'),('${ids.other}');
    insert into public.users(id) values('${ids.actor}'),('${ids.member2}'),('${ids.outsider}');
    insert into public.org_members values
      ('${ids.org}','${ids.actor}','active','member','all'),
      ('${ids.org}','${ids.member2}','active','member','assigned');
    insert into public.boards(id,org_id,source,is_system) values
      ('${ids.board}','${ids.org}','user',false),
      ('${ids.otherBoard}','${ids.other}','user',false),
      ('${ids.canonicalBoard}','${ids.org}','core.default-tab/new-lead',false),
      ('${ids.contractBoard}','${ids.org}','core.default-tab/contract-work',false);
    insert into public.board_groups values
      ('${ids.g1}','${ids.org}','${ids.board}'),
      ('${ids.gNl}','${ids.org}','${ids.canonicalBoard}'),
      ('${ids.gCw}','${ids.org}','${ids.contractBoard}');
    insert into public.board_columns(org_id,board_id,key,type,source,is_readonly) values
      ('${ids.org}','${ids.board}','memo','text','in',false),
      ('${ids.org}','${ids.board}','seal_status','text','in',false),
      ('${ids.org}','${ids.board}','contract_confirm','text','in',false),
      ('${ids.org}','${ids.board}','file_docs','file','in',false),
      ('${ids.org}','${ids.board}','assigned_owner','text','in',false),
      ('${ids.org}','${ids.canonicalBoard}','rep_name','text','in',false),
      ('${ids.org}','${ids.canonicalBoard}','phone','text','in',false),
      ('${ids.org}','${ids.canonicalBoard}','seal_status','text','in',false),
      ('${ids.org}','${ids.contractBoard}','title','text','in',false);
    -- 최소 권한 스텁: 활성 멤버면 업무·일괄 스코프 허용, 조직 밖은 거부 (테이블 생성 뒤에 둔다).
    create function public.effective_permission(p_org_id uuid, p_scope_key text) returns boolean
      language sql stable security definer set search_path = public, pg_temp as
      $$select exists(select 1 from public.org_members m where m.org_id = p_org_id and m.user_id = auth.uid() and m.status = 'active')$$;
    set app.actor='${ids.actor}';
  `);
  migrationSql = readFileSync(resolve(process.cwd(), "../supabase/migrations/153_item_operations_draft.sql"), "utf8");
  expect(migrationSql).toContain("153_item_operations_draft");
  expect(migrationSql).toContain("archive_board_item_atomic");
  expect(migrationSql).toContain("duplicate_board_item_atomic");
  expect(migrationSql).toContain("duplicate_canonical_deal_item_atomic");
  expect(migrationSql).toContain("set_board_item_parent_atomic");
  const canonicalSql = readFileSync(resolve(process.cwd(), "../supabase/migrations/087_new_lead_canonical.sql"), "utf8");
  const uniqueStart = canonicalSql.indexOf("create unique index if not exists deal_intake_org_phone_uq");
  const uniqueEnd = canonicalSql.indexOf("create table if not exists public.deal_intake_field_audit", uniqueStart);
  await db.exec(canonicalSql.slice(uniqueStart, uniqueEnd));
  await db.exec(`
    alter table public.deals add column updated_at timestamptz default now(), add column applied_on date;
    alter table public.deal_intake add column updated_at timestamptz default now(), add column address_detail text;
    create unique index fixture_deals_org_id on public.deals(org_id,id);
    create unique index fixture_items_org_id on public.items(org_id,id);
    create unique index fixture_intake_org_id on public.deal_intake(org_id,deal_id);
  `);
  await db.exec(canonicalSql.slice(canonicalSql.indexOf("create table if not exists public.deal_intake_field_audit"), canonicalSql.indexOf("alter table public.deal_intake enable row level security")));
  // Real canonical mutations, not mocked RPCs. Non-owner meta wrapper is preserved.
  const fieldStart = canonicalSql.indexOf("create or replace function public.update_new_lead_fields(");
  await db.exec(canonicalSql.slice(fieldStart, canonicalSql.indexOf("end $$;", fieldStart) + 7));
  await db.exec("grant execute on function public.update_new_lead_fields(uuid,uuid,uuid,jsonb,text) to authenticated");
  await db.exec(readFileSync(resolve(process.cwd(), "../supabase/migrations/110_bbe171_new_lead_title_audit.sql"), "utf8"));
  const metaSql = readFileSync(resolve(process.cwd(), "../supabase/migrations/120_bbe273_new_lead_full_intake.sql"), "utf8");
  await db.exec(metaSql.slice(metaSql.indexOf("create or replace function public.update_new_lead_intake_meta(")));
  const guardStart = metaSql.indexOf("create or replace function public.guard_new_lead_projection_write()");
  const guardEnd = metaSql.indexOf("for each row execute function public.guard_new_lead_projection_write();", guardStart) + "for each row execute function public.guard_new_lead_projection_write();".length;
  await db.exec(metaSql.slice(guardStart, guardEnd));
  const syncStart = metaSql.indexOf("create or replace function public.sync_new_lead_intake_projection()");
  const syncEnd = metaSql.indexOf("for each row execute function public.sync_new_lead_intake_projection();", syncStart) + "for each row execute function public.sync_new_lead_intake_projection();".length;
  await db.exec(metaSql.slice(syncStart, syncEnd));
  await db.exec(readFileSync(resolve(process.cwd(), "../supabase/migrations/135_issue599_assignment_ui_hardening.sql"), "utf8"));
  await db.exec(migrationSql);
});

afterAll(async () => db.close());

beforeEach(async () => {
  await db.exec(`
    truncate public.item_operation_receipts, public.item_duplicate_links, public.item_values,
      public.items, public.deal_intake, public.deals, public.companies cascade;
    update public.org_members set scope=case when user_id='${ids.actor}' then 'all' else 'assigned' end;
    insert into public.items(id,org_id,board_id,group_id,title,assigned_to,sort_order) values
      ('${ids.a}','${ids.org}','${ids.board}','${ids.g1}','A','${ids.actor}',0),
      ('${ids.b}','${ids.org}','${ids.board}','${ids.g1}','B','${ids.actor}',1),
      ('${ids.c}','${ids.org}','${ids.board}','${ids.g1}','C','${ids.actor}',2),
      ('${ids.foreign}','${ids.other}','${ids.otherBoard}',null,'F',null,0);
  `);
});

describe("153 repair: 정적 계약 (grant·직렬화 구조)", () => {
  it("진입 5종은 authenticated에 grant, service_role·anon에는 revoke", () => {
    for (const fn of [
      "archive_board_item_atomic",
      "restore_archived_board_item_atomic",
      "set_board_item_parent_atomic",
      "duplicate_board_item_atomic",
      "duplicate_canonical_deal_item_atomic",
    ]) {
      expect(migrationSql).toContain(`grant execute on function public.${fn}`);
      expect(migrationSql).toContain("to authenticated");
    }
    expect(migrationSql).toMatch(/revoke all on function public\.archive_board_item_atomic[^;]*service_role/);
  });

  it("내부 헬퍼·독립 link 기록은 grant가 없다", () => {
    for (const fn of ["item_operations_require_actor", "item_operations_visible", "record_item_duplicate_link_atomic"]) {
      const grants = migrationSql.match(new RegExp(`grant execute on function public\\.${fn}[^;]*;`, "g")) ?? [];
      expect(grants.filter((line) => line.includes("to authenticated"))).toEqual([]);
    }
  });

  it("receipt에는 ON CONFLICT DO NOTHING 은폐가 없다 (충돌은 advisory lock + 22023)", () => {
    const receiptInserts = migrationSql.match(/insert into public\.item_operation_receipts[\s\S]{0,300}?(;|on conflict)/gi) ?? [];
    expect(receiptInserts.length).toBeGreaterThan(0);
    for (const stmt of receiptInserts) {
      expect(stmt.toLowerCase()).not.toContain("on conflict");
    }
  });
});

describe("153 repair: 실제 authenticated 역할 (GRANT 성공·revoke 거부·outsider·무부수효과)", () => {
  it("authenticated 역할로 보관·복구가 성공한다", async () => {
    await asRole("authenticated", async () => {
      const archived = await db.query<{ item_id: string; replayed: boolean }>(
        "select * from public.archive_board_item_atomic($1,$2,$3,$4)",
        [ids.org, ids.board, ids.a, request(101)],
      );
      expect(archived.rows[0].replayed).toBe(false);
      const restored = await db.query<{ replayed: boolean }>(
        "select * from public.restore_archived_board_item_atomic($1,$2,$3,$4)",
        [ids.org, ids.board, ids.a, request(102)],
      );
      expect(restored.rows[0].replayed).toBe(false);
    });
    const active = await db.query("select id from public.items where org_id=$1 and board_id=$2 and archived_at is null and deleted_at is null", [ids.org, ids.board]);
    expect(active.rows.length).toBe(3);
  });

  it("revoke된 기능은 42883/42501로 막힌다", async () => {
    await db.exec("revoke execute on function public.archive_board_item_atomic(uuid,uuid,uuid,uuid,timestamptz) from authenticated");
    try {
      await asRole("authenticated", async () => {
        await expect(
          db.query("select * from public.archive_board_item_atomic($1,$2,$3,$4)", [ids.org, ids.board, ids.a, request(103)]),
        ).rejects.toThrow(/permission denied for function|does not exist/);
      });
    } finally {
      await db.exec("grant execute on function public.archive_board_item_atomic(uuid,uuid,uuid,uuid,timestamptz) to authenticated");
    }
    // grant 복구 후에는 다시 성공한다.
    await asRole("authenticated", async () => {
      const out = await db.query<{ replayed: boolean }>(
        "select * from public.archive_board_item_atomic($1,$2,$3,$4)", [ids.org, ids.board, ids.a, request(104)],
      );
      expect(out.rows[0].replayed).toBe(false);
    });
  });

  it("독립 link 기록 함수는 직접 호출이 막혀 있다 (원자 복제가 내부 처리)", async () => {
    await asRole("authenticated", async () => {
      await expect(
        db.query("select * from public.record_item_duplicate_link_atomic($1,$2,$3,$4,$5)", [ids.org, ids.board, ids.a, ids.b, request(105)]),
      ).rejects.toThrow(/permission denied for function/);
    });
  });

  it("조직 밖 행위자는 거부되고 부수효과가 없다", async () => {
    await asActor(ids.outsider, async () => {
      await asRole("authenticated", async () => {
        try {
          await db.query("select * from public.archive_board_item_atomic($1,$2,$3,$4)", [ids.org, ids.board, ids.a, request(106)]);
          expect.unreachable("outsider archive must be rejected");
        } catch (error) {
          expect(String((error as { code?: string }).code ?? "")).toBe("42501");
        }
      });
    });
    const receipts = await db.query("select * from public.item_operation_receipts where org_id=$1", [ids.org]);
    expect(receipts.rows.length).toBe(0);
    const item = await db.query<{ archived_at: string | null }>("select archived_at from public.items where id=$1", [ids.a]);
    expect(item.rows[0].archived_at).toBeNull();
  });

  it("타인 명의로 같은 request를 재사용하면 22023 (actor 바인딩)", async () => {
    await db.query("select * from public.archive_board_item_atomic($1,$2,$3,$4)", [ids.org, ids.board, ids.a, request(107)]);
    await db.exec(`update org_members set scope='all' where user_id='${ids.member2}'`);
    await asActor(ids.member2, async () => {
      await expect(
        db.query("select * from public.archive_board_item_atomic($1,$2,$3,$4)", [ids.org, ids.board, ids.a, request(107)]),
      ).rejects.toThrow(/payload mismatch/);
    });
  });

  it("정상 재시도는 CAS보다 먼저 replay된다 (lost response)", async () => {
    // 현재 updated_at을 CAS로 함께 보낸다. 첫 호출이 updated_at을 바꾸므로
    // 같은 내용의 재시도는 CAS가 낡았다 — replay가 CAS보다 먼저여야 성공한다.
    const stamp = await db.query<{ updated_at: string }>("select updated_at from public.items where id=$1", [ids.a]);
    const cas = new Date(stamp.rows[0].updated_at).toISOString();
    const first = await db.query<{ archived_at: string; replayed: boolean }>(
      "select * from public.archive_board_item_atomic($1,$2,$3,$4,$5)", [ids.org, ids.board, ids.a, request(108), cas],
    );
    expect(first.rows[0].replayed).toBe(false);
    const second = await db.query<{ archived_at: string; replayed: boolean }>(
      "select * from public.archive_board_item_atomic($1,$2,$3,$4,$5)", [ids.org, ids.board, ids.a, request(108), cas],
    );
    expect(second.rows[0].replayed).toBe(true);
    expect(String(second.rows[0].archived_at)).toBe(String(first.rows[0].archived_at));
    // 같은 requestId로 다른 항목을 보내면 22023.
    await expect(
      db.query("select * from public.archive_board_item_atomic($1,$2,$3,$4)", [ids.org, ids.board, ids.b, request(108)]),
    ).rejects.toThrow(/payload mismatch/);
  });

  it("이중 보관·미보관 복구는 22023", async () => {
    await db.query("select * from public.archive_board_item_atomic($1,$2,$3,$4)", [ids.org, ids.board, ids.a, request(109)]);
    await expect(db.query("select * from public.archive_board_item_atomic($1,$2,$3,$4)", [ids.org, ids.board, ids.a, request(110)])).rejects.toThrow(/already archived/);
    await expect(db.query("select * from public.restore_archived_board_item_atomic($1,$2,$3,$4)", [ids.org, ids.board, ids.b, request(111)])).rejects.toThrow(/not archived/);
  });

  it("낡은 CAS 버전은 40001, 보관 이력은 원장에 남는다", async () => {
    await expect(db.query("select * from public.archive_board_item_atomic($1,$2,$3,$4,$5)", [ids.org, ids.board, ids.a, request(112), "2000-01-01T00:00:00Z"])).rejects.toThrow(/changed before archive/);
    await db.query("select * from public.archive_board_item_atomic($1,$2,$3,$4)", [ids.org, ids.board, ids.a, request(113)]);
    const receipts = await db.query("select operation,actor_id from public.item_operation_receipts where org_id=$1 and item_id=$2", [ids.org, ids.a]);
    expect(receipts.rows.map((r) => (r as { operation: string }).operation)).toContain("archive");
    expect((receipts.rows[0] as { actor_id: string }).actor_id).toBe(ids.actor);
  });

  it("다른 조직 행은 22023", async () => {
    await expect(db.query("select * from public.archive_board_item_atomic($1,$2,$3,$4)", [ids.org, ids.board, ids.foreign, request(114)])).rejects.toThrow(/not found in this board/);
  });
});

describe("153 repair: 상하위 연결/해제 (직렬화·전체 순환·부모 가시성)", () => {
  it("연결·해제 후 하위 암묵변경 없음 (형제 그대로)", async () => {
    await db.query("select * from public.set_board_item_parent_atomic($1,$2,$3,$4,$5)", [ids.org, ids.board, ids.b, ids.a, request(121)]);
    const child = await db.query<{ parent_item_id: string }>("select parent_item_id from public.items where id=$1", [ids.b]);
    expect(child.rows[0].parent_item_id).toBe(ids.a);
    const sibling = await db.query<{ parent_item_id: string | null }>("select parent_item_id from public.items where id=$1", [ids.c]);
    expect(sibling.rows[0].parent_item_id).toBeNull();
    await db.query("select * from public.set_board_item_parent_atomic($1,$2,$3,$4,$5)", [ids.org, ids.board, ids.b, null, request(122)]);
    const cleared = await db.query<{ parent_item_id: string | null }>("select parent_item_id from public.items where id=$1", [ids.b]);
    expect(cleared.rows[0].parent_item_id).toBeNull();
  });

  it("자기참조·2단계 순환은 22023", async () => {
    await expect(db.query("select * from public.set_board_item_parent_atomic($1,$2,$3,$4,$5)", [ids.org, ids.board, ids.a, ids.a, request(123)])).rejects.toThrow(/its own parent/);
    await db.query("select * from public.set_board_item_parent_atomic($1,$2,$3,$4,$5)", [ids.org, ids.board, ids.b, ids.a, request(124)]);
    await expect(db.query("select * from public.set_board_item_parent_atomic($1,$2,$3,$4,$5)", [ids.org, ids.board, ids.a, ids.b, request(125)])).rejects.toThrow(/cycle/);
  });

  it("30단계 긴 체인의 순환도 검출한다 (25단계 조기종료 금지)", async () => {
    const chain: string[] = [];
    for (let n = 0; n < 30; n += 1) {
      const id = `00000000-0000-4000-8111-${String(n).padStart(12, "0")}`;
      chain.push(id);
    }
    await db.exec(`insert into public.items(id,org_id,board_id,group_id,title,assigned_to,sort_order) values ${chain.map((id, n) => `('${id}','${ids.org}','${ids.board}','${ids.g1}','N${n}','${ids.actor}',${10 + n})`).join(",")}`);
    for (let n = 1; n < chain.length; n += 1) {
      await db.exec(`update public.items set parent_item_id = '${chain[n - 1]}' where id = '${chain[n]}'`);
    }
    await expect(
      db.query("select * from public.set_board_item_parent_atomic($1,$2,$3,$4,$5)", [ids.org, ids.board, chain[0], chain[chain.length - 1], request(126)]),
    ).rejects.toThrow(/cycle/);
  });

  it("200단계 초과 체인은 fail-closed 22023", async () => {
    const chain: string[] = [];
    for (let n = 0; n < 205; n += 1) {
      chain.push(`00000000-0000-4000-8222-${String(n).padStart(12, "0")}`);
    }
    await db.exec(`insert into public.items(id,org_id,board_id,group_id,title,assigned_to,sort_order) values ${chain.map((id, n) => `('${id}','${ids.org}','${ids.board}','${ids.g1}','D${n}','${ids.actor}',${100 + n})`).join(",")}`);
    for (let n = 1; n < chain.length; n += 1) {
      await db.exec(`update public.items set parent_item_id = '${chain[n - 1]}' where id = '${chain[n]}'`);
    }
    const fresh = "00000000-0000-4000-8000-000000000099";
    await db.exec(`insert into public.items(id,org_id,board_id,group_id,title,assigned_to,sort_order) values('${fresh}','${ids.org}','${ids.board}','${ids.g1}','X','${ids.actor}',999)`);
    await expect(
      db.query("select * from public.set_board_item_parent_atomic($1,$2,$3,$4,$5)", [ids.org, ids.board, fresh, chain[chain.length - 1], request(127)]),
    ).rejects.toThrow(/too deep/);
  });

  it("가시성 없는 부모는 42501 (부모 권한 검사)", async () => {
    await db.exec(`update public.items set assigned_to = '${ids.actor}' where id = '${ids.a}'`);
    await db.exec(`update public.items set assigned_to = '${ids.member2}' where id = '${ids.b}'`);
    await asActor(ids.member2, async () => {
      await expect(
        db.query("select * from public.set_board_item_parent_atomic($1,$2,$3,$4,$5)", [ids.org, ids.board, ids.b, ids.a, request(128)]),
      ).rejects.toThrow(/parent item is not visible/);
    });
  });

  it("다른 보드 부모·보관/삭제 부모는 거부된다", async () => {
    await expect(
      db.query("select * from public.set_board_item_parent_atomic($1,$2,$3,$4,$5)", [ids.org, ids.board, ids.a, ids.foreign, request(129)]),
    ).rejects.toThrow(/same workspace and board/);
    await db.query("select * from public.archive_board_item_atomic($1,$2,$3,$4)", [ids.org, ids.board, ids.c, request(130)]);
    await expect(
      db.query("select * from public.set_board_item_parent_atomic($1,$2,$3,$4,$5)", [ids.org, ids.board, ids.a, ids.c, request(131)]),
    ).rejects.toThrow(/active item/);
  });
});

describe("153 repair: 안전한 복제 (컬럼 실측 + 금지키)", () => {
  it("허용 입력만 복사하고 금지키는 건너뛴다 (deal/담당자/부모 미복사)", async () => {
    await db.exec(`
      insert into public.item_values(org_id,item_id,column_key,value_jsonb) values
        ('${ids.org}','${ids.a}','memo','"hello"'),
        ('${ids.org}','${ids.a}','seal_status','"approved"'),
        ('${ids.org}','${ids.a}','contract_confirm','"yes"'),
        ('${ids.org}','${ids.a}','file_docs','"x"'),
        ('${ids.org}','${ids.a}','assigned_owner','"y"');
    `);
    const out = await db.query<{ source_item_id: string; new_item_id: string; copied_values: number; skipped_values: number; replayed: boolean }>(
      "select * from public.duplicate_board_item_atomic($1,$2,$3,$4,$5)",
      [ids.org, ids.board, ids.a, request(141), ids.dup],
    );
    expect(out.rows[0]).toMatchObject({ source_item_id: ids.a, new_item_id: ids.dup, copied_values: 1, skipped_values: 4, replayed: false });
    const created = await db.query<{ title: string; assigned_to: string | null; parent_item_id: string | null; archived_at: string | null; deleted_at: string | null }>(
      "select title,assigned_to,parent_item_id,archived_at,deleted_at from public.items where id=$1", [ids.dup],
    );
    expect(created.rows[0].title).toBe("A (복사본)");
    expect(created.rows[0].assigned_to).toBe(ids.actor);
    expect(created.rows[0].parent_item_id).toBeNull();
    expect(created.rows[0].archived_at).toBeNull();
    expect(created.rows[0].deleted_at).toBeNull();
    const values = await db.query<{ column_key: string }>("select column_key from public.item_values where item_id=$1", [ids.dup]);
    expect(values.rows.map((r) => r.column_key)).toEqual(["memo"]);
    const link = await db.query("select * from public.item_duplicate_links where org_id=$1 and new_item_id=$2", [ids.org, ids.dup]);
    expect(link.rows.length).toBe(1);
    const replay = await db.query<{ new_item_id: string; replayed: boolean }>(
      "select * from public.duplicate_board_item_atomic($1,$2,$3,$4,$5)", [ids.org, ids.board, ids.a, request(141), ids.dup],
    );
    expect(replay.rows[0]).toMatchObject({ new_item_id: ids.dup, replayed: true });
  });

  it("정본 보드는 단순복사 경로 거부 — 실패 이유 명시 (22023)", async () => {
    await db.exec(`insert into public.items(id,org_id,board_id,group_id,title,assigned_to,sort_order) values('00000000-0000-4000-8000-000000000045','${ids.org}','${ids.canonicalBoard}','${ids.gNl}','N','${ids.actor}',0)`);
    await expect(
      db.query("select * from public.duplicate_board_item_atomic($1,$2,$3,$4,$5)", [ids.org, ids.canonicalBoard, "00000000-0000-4000-8000-000000000045", request(142), "00000000-0000-4000-8000-000000000046"]),
    ).rejects.toThrow(/canonical/);
  });
});

describe("153 repair: 정본 딜 원자 복제 (회사 유지·출처 한 트랜잭션)", () => {
  async function seedDealSource(boardId: string, groupId: string, itemId: string) {
    await db.exec(`
      insert into public.companies(id,org_id,name) values('${ids.company}','${ids.org}','Seed Co')
      on conflict (id) do nothing;
      insert into public.deals(id,org_id,company_id,assigned_to,title) values('${ids.deal}','${ids.org}','${ids.company}','${ids.actor}','Seed Deal')
      on conflict (id) do nothing;
      insert into public.deal_intake(deal_id,org_id,representative_name,phone_normalized,phone_display,industry,acquisition_source)
      values('${ids.deal}','${ids.org}','Seed Rep','01012345678','010-1234-5678','제조업','검색광고')
      on conflict (deal_id) do nothing;
      insert into public.items(id,org_id,board_id,group_id,title,assigned_to,deal_id,sort_order) values('${itemId}','${ids.org}','${boardId}','${groupId}','Seed Item','${ids.actor}','${ids.deal}',0)
      on conflict (id) do nothing;
      update public.deal_intake set updated_at=updated_at where deal_id='${ids.deal}';
      insert into public.item_values(org_id,item_id,column_key,value_jsonb)
        select '${ids.org}','${itemId}',v.key,v.value from (values ('rep_name','"Seed Rep"'::jsonb),('phone','"010-1234-5678"'::jsonb)) v(key,value)
        where '${boardId}' <> '${ids.canonicalBoard}';
      insert into public.item_values(org_id,item_id,column_key,value_jsonb) values
        ('${ids.org}','${itemId}','seal_status','"approved"');
    `);
  }

  it("신규리드: 회사 유지·새 deal·담당자 미복사·출처 기록 (회사 추가 생성 없음)", async () => {
    await seedDealSource(ids.canonicalBoard, ids.gNl, ids.dealItem);
    const before = await db.query("select count(*)::integer as n from public.companies where org_id=$1", [ids.org]);
    const out = await db.query<{ source_item_id: string; new_item_id: string; new_deal_id: string; company_id: string; copied_values: number; skipped_values: number; replayed: boolean }>(
      "select * from public.duplicate_canonical_deal_item_atomic($1,$2,$3,$4,null,$5)",
      [ids.org, ids.canonicalBoard, ids.dealItem, request(151), "00000000-0000-4000-8000-000000000060"],
    );
    expect(out.rows[0]).toMatchObject({ source_item_id: ids.dealItem, replayed: false });
    expect(out.rows[0].company_id).toBe(ids.company);
    expect(out.rows[0].new_deal_id).not.toBe(ids.deal);
    const after = await db.query("select count(*)::integer as n from public.companies where org_id=$1", [ids.org]);
    expect((after.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n);
    const deal = await db.query<{ company_id: string; assigned_to: string }>("select company_id,assigned_to from public.deals where id=$1", [out.rows[0].new_deal_id]);
    expect(deal.rows[0].company_id).toBe(ids.company);
    expect(deal.rows[0].assigned_to).toBe(ids.actor);
    const intake = await db.query<{ representative_name: string }>("select representative_name from public.deal_intake where deal_id=$1", [out.rows[0].new_deal_id]);
    expect(intake.rows[0].representative_name).toBe("Seed Rep");
    const values = await db.query<{ column_key: string }>("select column_key from public.item_values where item_id=$1 order by column_key", [out.rows[0].new_item_id]);
    expect(values.rows.map((r) => r.column_key)).toEqual(["address_detail", "phone", "rep_name"]);
    const link = await db.query("select * from public.item_duplicate_links where org_id=$1 and new_item_id=$2", [ids.org, out.rows[0].new_item_id]);
    expect(link.rows.length).toBe(1);
  });

  it("계약업무 보드도 같은 원자 경로로 복제된다", async () => {
    await seedDealSource(ids.contractBoard, ids.gCw, "00000000-0000-4000-8000-000000000061");
    const out = await db.query<{ new_item_id: string; new_deal_id: string; company_id: string; replayed: boolean }>(
      "select * from public.duplicate_canonical_deal_item_atomic($1,$2,$3,$4,null,$5)",
      [ids.org, ids.contractBoard, "00000000-0000-4000-8000-000000000061", request(152), "00000000-0000-4000-8000-000000000062"],
    );
    expect(out.rows[0].replayed).toBe(false);
    expect(out.rows[0].company_id).toBe(ids.company);
    expect(out.rows[0].new_deal_id).not.toBe(ids.deal);
  });

  it("재시도는 같은 결과를 replay하고 deal이 늘지 않는다", async () => {
    await seedDealSource(ids.canonicalBoard, ids.gNl, ids.dealItem);
    const first = await db.query<{ new_item_id: string; new_deal_id: string; replayed: boolean }>(
      "select * from public.duplicate_canonical_deal_item_atomic($1,$2,$3,$4,null,$5)",
      [ids.org, ids.canonicalBoard, ids.dealItem, request(153), "00000000-0000-4000-8000-000000000063"],
    );
    const dealsBefore = await db.query("select count(*)::integer as n from public.deals where org_id=$1", [ids.org]);
    const second = await db.query<{ new_item_id: string; new_deal_id: string; replayed: boolean }>(
      "select * from public.duplicate_canonical_deal_item_atomic($1,$2,$3,$4,null,$5)",
      [ids.org, ids.canonicalBoard, ids.dealItem, request(153), "00000000-0000-4000-8000-000000000063"],
    );
    expect(second.rows[0]).toMatchObject({ new_item_id: first.rows[0].new_item_id, new_deal_id: first.rows[0].new_deal_id, replayed: true });
    const dealsAfter = await db.query("select count(*)::integer as n from public.deals where org_id=$1", [ids.org]);
    expect((dealsAfter.rows[0] as { n: number }).n).toBe((dealsBefore.rows[0] as { n: number }).n);
    await expect(
      db.query("select * from public.duplicate_canonical_deal_item_atomic($1,$2,$3,$4,null,$5)", [ids.org, ids.canonicalBoard, ids.dealItem, request(153), "00000000-0000-4000-8000-000000000064"]),
    ).rejects.toThrow(/payload mismatch/);
  });

  it("deal 없는 행·일반 보드·outsider는 거부되고 부수효과가 없다", async () => {
    await db.exec(`insert into public.items(id,org_id,board_id,group_id,title,assigned_to,sort_order) values('00000000-0000-4000-8000-000000000068','${ids.org}','${ids.canonicalBoard}','${ids.gNl}','No Deal','${ids.actor}',0)`);
    await expect(
      db.query("select * from public.duplicate_canonical_deal_item_atomic($1,$2,$3,$4,null,$5)", [ids.org, ids.canonicalBoard, "00000000-0000-4000-8000-000000000068", request(154), "00000000-0000-4000-8000-000000000065"]),
    ).rejects.toThrow(/deal-linked/);
    await seedDealSource(ids.canonicalBoard, ids.gNl, ids.dealItem);
    await expect(
      db.query("select * from public.duplicate_canonical_deal_item_atomic($1,$2,$3,$4,null,$5)", [ids.org, ids.board, ids.dealItem, request(155), "00000000-0000-4000-8000-000000000066"]),
    ).rejects.toThrow(/canonical/);
    await asActor(ids.outsider, async () => {
      try {
        await db.query("select * from public.duplicate_canonical_deal_item_atomic($1,$2,$3,$4,null,$5)", [ids.org, ids.canonicalBoard, ids.dealItem, request(156), "00000000-0000-4000-8000-000000000067"]);
        expect.unreachable("outsider canonical duplicate must be rejected");
      } catch (error) {
        expect(String((error as { code?: string }).code ?? "")).toBe("42501");
      }
    });
    const deals = await db.query("select count(*)::integer as n from public.deals where org_id=$1", [ids.org]);
    expect((deals.rows[0] as { n: number }).n).toBe(1);
  });
});


describe("153 edge: deployed constraints and archived canonical RPCs", () => {
  async function seedCanonical() {
    await db.exec(`
      insert into companies(id,org_id,name) values('${ids.company}','${ids.org}','Synthetic company');
      insert into deals(id,org_id,company_id,title,assigned_to) values('${ids.deal}','${ids.org}','${ids.company}','Synthetic','${ids.actor}');
      insert into deal_intake(deal_id,org_id,representative_name,phone_normalized,phone_display,email_normalized,acquisition_source,source_external_id)
        values('${ids.deal}','${ids.org}','Original','01012345678','010-1234-5678','synthetic@example.test','test','source-1');
      insert into items(id,org_id,board_id,group_id,title,assigned_to,deal_id)
        values('${ids.dealItem}','${ids.org}','${ids.canonicalBoard}','${ids.gNl}','Synthetic','${ids.actor}','${ids.deal}');
      update deal_intake set updated_at=updated_at where deal_id='${ids.deal}';
    `);
  }
  async function archiveCanonical() {
    await seedCanonical();
    await asRole("authenticated", () => db.query("select * from archive_board_item_atomic($1,$2,$3,$4)", [ids.org,ids.canonicalBoard,ids.dealItem,request(501)]));
  }
  it("keeps all 087 identity indexes, clears duplicate identity keys, preserves source and company", async () => {
    await seedCanonical();
    // Model an old stale projection without changing the authoritative intake.
    await db.exec(`begin; select set_config('moawork.new_lead_projection_write','on',true);
      update item_values set value_jsonb='"Stale projection"' where item_id='${ids.dealItem}' and column_key='rep_name'; commit;`);
    expect((await db.query<{flag:string}>("select current_setting('moawork.new_lead_projection_write',true) flag")).rows[0].flag).not.toBe("on");
    const out = await asRole("authenticated", () => db.query<{new_deal_id:string;new_item_id:string;company_id:string}>("select * from duplicate_canonical_deal_item_atomic($1,$2,$3,$4,null,$5)",[ids.org,ids.canonicalBoard,ids.dealItem,request(502),ids.dup]));
    const clone = (await db.query<{phone_normalized:string|null;phone_display:string|null;email_normalized:string|null;source_external_id:string|null;representative_name:string}>("select * from deal_intake where deal_id=$1",[out.rows[0].new_deal_id])).rows[0];
    expect(clone).toMatchObject({phone_normalized:null,phone_display:null,email_normalized:null,source_external_id:null,representative_name:"Original"});
    expect(out.rows[0].company_id).toBe(ids.company);
    expect((await db.query("select value_jsonb from item_values where item_id=$1 and column_key='rep_name'",[out.rows[0].new_item_id])).rows[0]).toEqual({value_jsonb:"Original"});
    expect((await db.query("select value_jsonb from item_values where item_id=$1 and column_key='phone'",[out.rows[0].new_item_id])).rows[0]).toEqual({value_jsonb:null});
    await expect(db.query("update item_values set value_jsonb='\"Direct bypass\"' where item_id=$1 and column_key='rep_name'",[out.rows[0].new_item_id])).rejects.toMatchObject({code:"42501"});
    expect((await db.query("select phone_normalized,email_normalized,source_external_id from deal_intake where deal_id=$1",[ids.deal])).rows[0]).toMatchObject({phone_normalized:"01012345678",email_normalized:"synthetic@example.test",source_external_id:"source-1"});
    expect((await db.query("select count(*)::int n from companies")).rows[0]).toEqual({n:1});
    await expect(db.query("update deal_intake set phone_normalized='01012345678' where deal_id=$1",[out.rows[0].new_deal_id])).rejects.toMatchObject({code:"23505"});
    await expect(db.query("update deal_intake set email_normalized='synthetic@example.test' where deal_id=$1",[out.rows[0].new_deal_id])).rejects.toMatchObject({code:"23505"});
    await expect(db.query("update deal_intake set source_external_id='source-1' where deal_id=$1",[out.rows[0].new_deal_id])).rejects.toMatchObject({code:"23505"});
  });
  it.each([
    ["title", "select * from update_new_lead_title($1,$2,$3,'Blocked title')"],
    ["field", `select * from update_new_lead_fields($1,$2,$3,'{"representative_name":"Blocked name"}')`],
    ["meta", `select * from update_new_lead_intake_meta($1,$2,$3,'{"address_detail":"Blocked address"}')`],
  ])("archived %s fails through the actual authenticated RPC without audit or receipt writes", async (_name, sql) => {
    await archiveCanonical();
    await asRole("authenticated", async () => {
      await expect(db.query(sql,[ids.org,ids.deal,request(503)])).rejects.toMatchObject({code:"55000"});
    });
    expect((await db.query("select title from deals where id=$1",[ids.deal])).rows[0]).toEqual({title:"Synthetic"});
    expect((await db.query("select representative_name,address_detail from deal_intake where deal_id=$1",[ids.deal])).rows[0]).toEqual({representative_name:"Original",address_detail:null});
    expect((await db.query("select count(*)::int n from deal_intake_field_audit")).rows[0]).toEqual({n:0});
    expect((await db.query("select count(*)::int n from new_lead_requests")).rows[0]).toEqual({n:0});
  });
  it("restore reopens the same row, while combined restore-and-edit is rejected", async () => {
    await archiveCanonical();
    await expect(db.query("update items set archived_at=null,archived_by=null,title='smuggled' where id=$1",[ids.dealItem])).rejects.toMatchObject({code:"55000"});
    await asRole("authenticated", () => db.query("select * from restore_archived_board_item_atomic($1,$2,$3,$4)",[ids.org,ids.canonicalBoard,ids.dealItem,request(504)]));
    await asRole("authenticated", () => db.query("select * from update_new_lead_title($1,$2,$3,'Restored title')",[ids.org,ids.deal,request(505)]));
    expect((await db.query("select title,archived_at from items where id=$1",[ids.dealItem])).rows[0]).toEqual({title:"Restored title",archived_at:null});
  });
  it("blocks item cells, position and direct canonical state writes while archived", async () => {
    await archiveCanonical();
    await expect(db.query("update items set sort_order=99 where id=$1",[ids.dealItem])).rejects.toMatchObject({code:"55000"});
    await expect(db.query("insert into item_values(org_id,item_id,column_key,value_jsonb) values($1,$2,'memo','\"blocked\"')",[ids.org,ids.dealItem])).rejects.toMatchObject({code:"55000"});
    await expect(db.query("update item_values set value_jsonb='\"blocked\"' where item_id=$1",[ids.dealItem])).rejects.toMatchObject({code:"55000"});
    await expect(db.query("delete from item_values where item_id=$1",[ids.dealItem])).rejects.toMatchObject({code:"55000"});
    await expect(db.query("update deals set stage_id=gen_random_uuid() where id=$1",[ids.deal])).rejects.toMatchObject({code:"55000"});
  });
  it("keeps shared company, other deals and another active projection writable", async () => {
    await archiveCanonical();
    await db.query("update companies set name='Still editable' where id=$1",[ids.company]);
    const otherDeal = (await db.query<{id:string}>("insert into deals(org_id,company_id,title,assigned_to) values($1,$2,'Other',$3) returning id",[ids.org,ids.company,ids.actor])).rows[0].id;
    await db.query("update deals set title='Other changed' where id=$1",[otherDeal]);
    await db.query("insert into items(id,org_id,board_id,group_id,title,assigned_to,deal_id) values($1,$2,$3,$4,'Active projection',$5,$6)",[ids.dup,ids.org,ids.contractBoard,ids.gCw,ids.actor,ids.deal]);
    await db.query("update deals set title='Shared active deal' where id=$1",[ids.deal]);
    await db.query("update deal_intake set industry='Active industry' where deal_id=$1",[ids.deal]);
    expect((await db.query("select title from items where id=$1",[ids.dealItem])).rows[0]).toEqual({title:"Synthetic"});
    await expect(db.query("update items set title='Archived projection edit' where id=$1",[ids.dealItem])).rejects.toMatchObject({code:"55000"});
  });
  it("archive replay checks current row visibility after scope revocation", async () => {
    await db.query("update items set assigned_to=$1 where id=$2",[ids.member2,ids.a]);
    await db.query("select * from archive_board_item_atomic($1,$2,$3,$4)",[ids.org,ids.board,ids.a,request(506)]);
    await db.exec(`update org_members set scope='assigned' where user_id='${ids.actor}'`);
    await asRole("authenticated", async () => {
      await expect(db.query("select * from archive_board_item_atomic($1,$2,$3,$4)",[ids.org,ids.board,ids.a,request(506)])).rejects.toMatchObject({code:"42501"});
    });
  });
  it("generic copy belongs to its creator and never inherits the source owner cell", async () => {
    await db.exec(`update org_members set scope='assigned' where user_id='${ids.actor}'; insert into board_columns(org_id,board_id,key) values('${ids.org}','${ids.board}','owner'); insert into item_values(org_id,item_id,column_key,value_jsonb) values('${ids.org}','${ids.a}','owner','"${ids.member2}"');`);
    await asRole("authenticated", () => db.query("select * from duplicate_board_item_atomic($1,$2,$3,$4,$5)",[ids.org,ids.board,ids.a,request(507),ids.dup]));
    expect((await db.query("select assigned_to from items where id=$1",[ids.dup])).rows[0]).toEqual({assigned_to:ids.actor});
    expect((await db.query("select count(*)::int n from item_values where item_id=$1 and column_key='owner'",[ids.dup])).rows[0]).toEqual({n:0});
  });
});
