import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const sql117 = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/117_bbe237_company_start_work.sql"),
  "utf8",
);
const sql140 = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/140_issue588_company_work_group.sql"),
  "utf8",
);
const sql141 = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/141_issue632_start_company_work_v2.sql"),
  "utf8",
);
const sql155 = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/155_intake_labels_atomic_repair.sql"),
  "utf8",
);
const ids = {
  orgA: "00000000-0000-4000-8000-000000000001",
  orgB: "00000000-0000-4000-8000-000000000002",
  owner: "00000000-0000-4000-8000-000000000010",
  member: "00000000-0000-4000-8000-000000000011",
  outsider: "00000000-0000-4000-8000-000000000012",
  idle: "00000000-0000-4000-8000-000000000013",
  boardA: "00000000-0000-4000-8000-000000000020",
  boardB: "00000000-0000-4000-8000-000000000021",
  groupA: "00000000-0000-4000-8000-000000000030",
  groupB: "00000000-0000-4000-8000-000000000031",
  colA: "00000000-0000-4000-8000-000000000040",
  req: (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`,
};


async function actor(db: PGlite, userId: string) {
  await db.exec(`select set_config('request.jwt.claim.sub','${userId}',false)`);
}

describe("155 create_company_and_start_work (PGlite actual SQL)", () => {
  let db: PGlite;
  beforeAll(async () => { db = new PGlite(); await db.waitReady; });
  afterAll(async () => { await db?.close(); }, 15_000);
  beforeEach(async () => {
    // Reuse only the WASM engine. Every test still installs the real SQL on a
    // fresh schema with autocommit, fresh roles and no inherited actor/GUCs.
    await db.exec(`reset role; reset all;
      drop schema if exists public cascade; drop schema if exists auth cascade;
      drop role if exists anon; drop role if exists authenticated; drop role if exists service_role;
      create schema public; grant usage on schema public to public;
      select set_config('app.uid','',false), set_config('request.jwt.claim.sub','',false);`);
    // PGlite는 SQL 함수 본문을 만들 때 바로 확인하므로 표를 먼저 만든다.
    await db.exec(`
      create schema auth; create role anon; create role authenticated; create role service_role;
      create table users(id uuid primary key); create table orgs(id uuid primary key,status text);
      create table org_members(org_id uuid,user_id uuid,role text,scope text,status text,primary key(org_id,user_id));
      create table boards(id uuid primary key,org_id uuid,source text,is_system boolean not null default false);
      create table board_groups(id uuid primary key,org_id uuid,board_id uuid,sort_order int not null default 0);
      create table board_columns(id uuid primary key,org_id uuid,board_id uuid,key text,type text,source text,is_readonly boolean not null default false,move_rule_jsonb jsonb,options_jsonb jsonb);
      create table companies(id uuid primary key default gen_random_uuid(),org_id uuid,name text,biz_type text,region text,owner_name text,phone text,founded_on date,assigned_to uuid,merged_into uuid);
      create table pipelines(id uuid primary key default gen_random_uuid(),org_id uuid,name text);
      create table stages(id uuid primary key default gen_random_uuid(),pipeline_id uuid,name text,sort_order int);
      create table deals(id uuid primary key default gen_random_uuid(),org_id uuid,company_id uuid,pipeline_id uuid,stage_id uuid,assigned_to uuid,title text);
      create table items(id uuid primary key default gen_random_uuid(),org_id uuid,board_id uuid,group_id uuid,title text,assigned_to uuid,deal_id uuid);
      create table company_work_start_requests(org_id uuid,request_id uuid,company_id uuid,actor_id uuid,deal_id uuid,item_id uuid,payload jsonb,primary key(org_id,request_id));
      create table audit_logs(id uuid primary key default gen_random_uuid(),org_id uuid,actor uuid,action text,target_type text,target_id uuid,meta jsonb);`);
    await db.exec(`
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function public.is_org_member(p_org uuid) returns boolean language sql stable as $$select true$$;
      create function public.effective_permission(p_org uuid, p_key text) returns boolean language sql stable as $$
        select exists(select 1 from public.org_members
          where org_id = p_org and user_id = auth.uid() and status = 'active'
            and (role in ('owner','admin') or scope = 'all'
                 or p_key in ('work.item_upsert', 'work.view_tabs')))$$;
      create function public.begin_guarded_migration(p_logical_key text,p_file_name text,p_file_digest text,p_expected_predecessor text,p_executor text,p_thread_id text,p_foundation boolean) returns void language sql as $$select 1$$;
      create function public.create_new_lead_with_founded_month(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,uuid,text,uuid[],text) returns void language sql as $$select 1$$;`);
    await db.exec(`
      insert into users values('${ids.owner}'),('${ids.member}'),('${ids.outsider}'),('${ids.idle}');
      insert into orgs values('${ids.orgA}','active'),('${ids.orgB}','active');
      insert into org_members values
        ('${ids.orgA}','${ids.owner}','owner','all','active'),
        ('${ids.orgA}','${ids.member}','member','assigned','active'),
        ('${ids.orgA}','${ids.idle}','member','assigned','inactive'),
        ('${ids.orgB}','${ids.outsider}','owner','all','active');
      insert into boards(id,org_id,source) values('${ids.boardA}','${ids.orgA}','core.default-tab/contract-work'),('${ids.boardB}','${ids.orgB}','core.default-tab/contract-work');
      insert into board_groups values('${ids.groupA}','${ids.orgA}','${ids.boardA}',0),('${ids.groupB}','${ids.orgB}','${ids.boardB}',0);
      insert into board_columns(id,org_id,board_id,key,type,source) values('${ids.colA}','${ids.orgA}','${ids.boardA}','progress_memo','select','in');
      insert into pipelines(id,org_id,name) values('00000000-0000-4000-8000-000000000050','${ids.orgA}','기본');
      insert into stages(id,pipeline_id,name,sort_order) values('00000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000050','진행',0);
    `);
    // 117→140→141 실제 구현을 소스 fixture로 잇는다 — 141 영수증 replay 상호운용을
    // 그림자 스텁이 아니라 실제 코드로 검증한다. 150은 155 말미 생존 확인용 스텁만 둔다.
    await db.exec(sql117);
    await db.exec(sql140);
    await db.exec(sql141);
    await db.exec(sql155);
    await actor(db, ids.owner);
  });

  function intake(request: string, overrides: Record<string, string | null> = {}, org = ids.orgA, board = ids.boardA, group: string | null = ids.groupA) {
    const arg = (v: string | null) => (v === null ? "null" : `'${v.replace(/'/g, "''")}'`);
    const base: Record<string, string | null> = {
      name: "모아상사", biz: "개인사업자", founded: "2024-03-01",
      region: "서울_강남구", phone: "02-1234-5678", ownerName: "김대표",
    };
    const v = { ...base, ...overrides };
    const groupArg = group === null ? "null" : `'${group}'`;
    return `select * from create_company_and_start_work('${org}','${board}',${groupArg},'${request}',${arg(v.name)},${arg(v.biz)},${arg(v.founded)},${arg(v.region)},${arg(v.phone)},${arg(v.ownerName)})`;
  }

  async function counts() {
    const q = async (t: string) => (await db.query<{ n: number }>(`select count(*)::int n from ${t}`)).rows[0].n;
    return { companies: await q("companies"), deals: await q("deals"), items: await q("items") };
  }

  it("한 트랜잭션으로 회사·딜·아이템을 만들고 원장을 남긴다", async () => {
    const first = await db.query<{ company_id: string; deal_id: string; item_id: string; replayed: boolean }>(
      intake(ids.req(1)));
    expect(first.rows[0].replayed).toBe(false);
    const company = (await db.query<{ name: string; biz_type: string; founded_on: string; assigned_to: string }>(
      `select name,biz_type,founded_on::text founded_on,assigned_to::text assigned_to from companies where id='${first.rows[0].company_id}'`)).rows[0];
    expect(company).toMatchObject({ name: "모아상사", biz_type: "개인사업자", founded_on: "2024-03-01", assigned_to: ids.owner });
    const item = (await db.query<{ board_id: string; group_id: string }>(
      `select board_id::text board_id,group_id::text group_id from items where id='${first.rows[0].item_id}'`)).rows[0];
    expect(item).toEqual({ board_id: ids.boardA, group_id: ids.groupA });
    expect(await counts()).toEqual({ companies: 1, deals: 1, items: 1 });
  });

  it("잃어버린 응답의 재시도는 같은 회사·딜을 돌려주고 둘을 만들지 않는다", async () => {
    const first = await db.query<{ company_id: string; deal_id: string; item_id: string }>(intake(ids.req(2)));
    const replay = await db.query<{ company_id: string; deal_id: string; item_id: string; replayed: boolean }>(
      intake(ids.req(2)));
    expect(replay.rows[0]).toEqual({ ...first.rows[0], replayed: true });
    expect(await counts()).toEqual({ companies: 1, deals: 1, items: 1 });
  });

  it("같은 열쇠에 다른 내용은 거절하고 아무것도 만들지 않는다", async () => {
    await db.query(intake(ids.req(3)));
    await expect(db.query(intake(ids.req(3), { name: "다른상사" }))).rejects.toThrow(/idempotency key reuse/);
    await actor(db, ids.member);
    await expect(db.query(intake(ids.req(3)))).rejects.toThrow(/idempotency key reuse/);
    expect(await counts()).toEqual({ companies: 1, deals: 1, items: 1 });
  });

  it("위조된 보드·그룹이면 회사를 만들지 않는다", async () => {
    await expect(db.query(intake(ids.req(4), {}, ids.orgA, ids.boardB))).rejects.toThrow(/target unavailable/);
    await expect(db.query(intake(ids.req(5), {}, ids.orgA, ids.boardA, ids.groupB))).rejects.toThrow(/target unavailable/);
    expect(await counts()).toEqual({ companies: 0, deals: 0, items: 0 });
  });

  it("바깥 사람·휴면 멤버는 권한에서 떨어지고 회사를 만들지 않는다", async () => {
    await actor(db, ids.outsider);
    await expect(db.query(intake(ids.req(6), {}, ids.orgA))).rejects.toThrow(/permission denied/);
    await actor(db, ids.idle);
    await expect(db.query(intake(ids.req(7)))).rejects.toThrow(/permission denied/);
    expect(await counts()).toEqual({ companies: 0, deals: 0, items: 0 });
  });

  it("잘못된 창업일자·빈 이름은 회사를 만들지 않고 전체를 되돌린다", async () => {
    await expect(db.query(intake(ids.req(8), { founded: "2024-13-40" }))).rejects.toThrow(/founded invalid/);
    await expect(db.query(intake(ids.req(9), { name: "   " }))).rejects.toThrow(/input required/);
    expect(await counts()).toEqual({ companies: 0, deals: 0, items: 0 });
  });

  it("그룹을 안 넘기면 맨 위 그룹에 넣는다", async () => {
    const row = await db.query<{ item_id: string }>(intake(ids.req(10), {}, ids.orgA, ids.boardA, null));
    const item = (await db.query<{ group_id: string }>(
      `select group_id::text group_id from items where id='${row.rows[0].item_id}'`)).rows[0];
    expect(item.group_id).toBe(ids.groupA);
  });

  it("genuinely new 열쇠의 같은 이름은 막고 쓰지 않는다 — 고객 데이터 유출 없음", async () => {
    await db.query(intake(ids.req(11)));
    await expect(db.query(intake(ids.req(12)))).rejects.toThrow(/duplicate candidate/);
    expect(await counts()).toEqual({ companies: 1, deals: 1, items: 1 });
  });

  it("띄어쓰기·대소문자만 다른 같은 이름도 막는다", async () => {
    await db.query(intake(ids.req(13)));
    await expect(db.query(intake(ids.req(14), { name: "  모아상사 " }))).rejects.toThrow(/duplicate candidate/);
    expect(await counts()).toEqual({ companies: 1, deals: 1, items: 1 });
  });

  it("replay는 후보 차단보다 먼저다 — 자신의 회사여도 같은 열쇠+같은 내용은 같은 답이다", async () => {
    const first = await db.query<{ company_id: string; deal_id: string; item_id: string }>(
      intake(ids.req(15)));
    // 보이는 목록에는 자신이 막 만든 회사가 있다 — 그래도 같은 열쇠면 replay다.
    const replay = await db.query<{ company_id: string; deal_id: string; item_id: string; replayed: boolean }>(
      intake(ids.req(15)));
    expect(replay.rows[0]).toEqual({ ...first.rows[0], replayed: true });
    expect(await counts()).toEqual({ companies: 1, deals: 1, items: 1 });
  });

  it("141 실제 구현과 영수증을 주고받는다 — 155 뒤 같은 열쇠로 옛 경로가 같은 딜·아이템을 본다", async () => {
    const first = await db.query<{ company_id: string; deal_id: string; item_id: string }>(
      intake(ids.req(16)));
    const companyId = first.rows[0].company_id;
    const via141 = await db.query<{ deal_id: string; item_id: string; replayed: boolean }>(
      `select * from start_company_work_v2('${ids.orgA}','${companyId}','${ids.req(16)}','${ids.groupA}')`);
    expect(via141.rows[0]).toEqual({
      deal_id: first.rows[0].deal_id,
      item_id: first.rows[0].item_id,
      replayed: true,
    });
    expect(await counts()).toEqual({ companies: 1, deals: 1, items: 1 });
  });
  it("current permission denial precedes all writes and receipt replay", async () => {
    const first = intake(ids.req(30));
    await db.query(first);
    await db.exec(`create or replace function public.effective_permission(p_org uuid,p_key text) returns boolean language sql stable as $$select false$$`);
    await expect(db.query(first)).rejects.toThrow(/permission denied/);
    await expect(db.query(intake(ids.req(31), { name: "Denied company" }))).rejects.toThrow(/permission denied/);
    expect(await counts()).toEqual({ companies: 1, deals: 1, items: 1 });
  });

  it("reassignment revokes the original member's receipt access", async () => {
    await actor(db, ids.member);
    await db.query(intake(ids.req(33)));
    await db.exec(`update companies set assigned_to = '${ids.owner}'`);
    await expect(db.query(intake(ids.req(33)))).rejects.toThrow(/permission denied/);
    expect(await counts()).toEqual({ companies: 1, deals: 1, items: 1 });
  });

  it("projection failure after company/deal inserts rolls back every write", async () => {
    await db.exec(`create function reject_projection() returns trigger language plpgsql as $$begin raise exception 'projection failed'; end$$;
      create trigger reject_projection before insert on items for each row execute function reject_projection()`);
    await expect(db.query(intake(ids.req(32)))).rejects.toThrow(/projection failed/);
    expect(await counts()).toEqual({ companies: 0, deals: 0, items: 0 });
    for (const table of ["company_intake_requests", "company_work_start_requests", "audit_logs"]) {
      expect((await db.query<{ n: number }>(`select count(*)::int n from ${table}`)).rows[0].n).toBe(0);
    }
  });

});
