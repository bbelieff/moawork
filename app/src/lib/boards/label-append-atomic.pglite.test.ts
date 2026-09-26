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
  boardA: "00000000-0000-4000-8000-000000000020",
  boardB: "00000000-0000-4000-8000-000000000021",
  groupA: "00000000-0000-4000-8000-000000000030",
  colNormal: "00000000-0000-4000-8000-000000000040",
  colStage: "00000000-0000-4000-8000-000000000041",
  colRegion: "00000000-0000-4000-8000-000000000042",
  colReadonly: "00000000-0000-4000-8000-000000000043",
  colCalc: "00000000-0000-4000-8000-000000000044",
  colMoveRule: "00000000-0000-4000-8000-000000000045",
  colText: "00000000-0000-4000-8000-000000000046",
  colLabels: "00000000-0000-4000-8000-000000000047",
  req: (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`,
};


async function actor(db: PGlite, userId: string) {
  await db.exec(`select set_config('request.jwt.claim.sub','${userId}',false)`);
}

describe("155 append_board_column_label_option (PGlite actual SQL)", () => {
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
    // rig 권한 근사: owner/admin/all은 전부, assigned 멤버는 work.item_upsert만.
    // 실제 effective_permission이 아니라 «DB 경계에서 권한을 먼저 본다»는 순서의 검증용이다.
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
      insert into users values('${ids.owner}'),('${ids.member}'),('${ids.outsider}');
      insert into orgs values('${ids.orgA}','active'),('${ids.orgB}','active');
      insert into org_members values
        ('${ids.orgA}','${ids.owner}','owner','all','active'),
        ('${ids.orgA}','${ids.member}','member','assigned','active'),
        ('${ids.orgB}','${ids.outsider}','owner','all','active');
      insert into boards(id,org_id,source) values('${ids.boardA}','${ids.orgA}','core.default-tab/contract-work'),('${ids.boardB}','${ids.orgB}','core.default-tab/contract-work');
      insert into board_groups values('${ids.groupA}','${ids.orgA}','${ids.boardA}',0);
      insert into board_columns(id,org_id,board_id,key,type,source,options_jsonb) values
        ('${ids.colNormal}','${ids.orgA}','${ids.boardA}','progress_memo','select','in',
         '{"options":[{"id":"사과","label":"사과","color":"#ff0000","order":0},{"id":"배","label":"배","order":1}],"meta_version":7}'),
        ('${ids.colStage}','${ids.orgA}','${ids.boardA}','consult_status','status','in','{"options":[]}'),
        ('${ids.colRegion}','${ids.orgA}','${ids.boardA}','sido','select','in','{"options":[]}'),
        ('${ids.colText}','${ids.orgA}','${ids.boardA}','memo','text','in','{"options":[]}'),
        ('${ids.colLabels}','${ids.orgA}','${ids.boardA}','legacy_note','select','in',
         '{"labels":[{"id":"옛값","label":"옛값","order":0}]}');
      insert into board_columns(id,org_id,board_id,key,type,source,is_readonly,options_jsonb) values
        ('${ids.colReadonly}','${ids.orgA}','${ids.boardA}','ro_note','select','in',true,'{"options":[]}');
      insert into board_columns(id,org_id,board_id,key,type,source,options_jsonb) values
        ('${ids.colCalc}','${ids.orgA}','${ids.boardA}','calc_note','select','calc','{"options":[]}');
      insert into board_columns(id,org_id,board_id,key,type,source,move_rule_jsonb,options_jsonb) values
        ('${ids.colMoveRule}','${ids.orgA}','${ids.boardA}','flow_note','status','in','{"x":"y"}','{"options":[]}');
    `);
    // 117→140→141 실제 구현을 소스 fixture로 잇는다 — 155 생존 확인이 실제 141을 본다.
    // 150은 생존 확인용 스텁만 둔다.
    await db.exec(sql117);
    await db.exec(sql140);
    await db.exec(sql141);
    await db.exec(sql155);
    await actor(db, ids.owner);
  });

  function append(column: string, request: string, label: string, org = ids.orgA, board = ids.boardA) {
    const lit = label.replace(/'/g, "''");
    return `select * from append_board_column_label_option('${org}','${board}','${column}','${request}','${lit}')`;
  }

  async function optionsOf(column: string) {
    const rows = (await db.query<{ options_jsonb: { options?: unknown[]; labels?: unknown[] } | null }>(
      `select options_jsonb from board_columns where id='${column}'`)).rows;
    return rows[0].options_jsonb;
  }

  it("동시 추가가 둘 다 살아남는다 — 색·순서·메타데이터 보존", async () => {
    const a = await db.query<{ option_id: string; created: boolean; replayed: boolean }>(
      append(ids.colNormal, ids.req(1), "새 라벨A"));
    expect(a.rows[0]).toEqual({ option_id: "새 라벨A", created: true, replayed: false });
    // B는 A를 모르는 낡은 스냅샷을 들고 와도 라벨 문자열만 보낸다 — 서버가 잠금 아래 다시 읽는다.
    const b = await db.query<{ option_id: string; created: boolean; replayed: boolean }>(
      append(ids.colNormal, ids.req(2), "새 라벨B"));
    expect(b.rows[0].created).toBe(true);
    const stored = await optionsOf(ids.colNormal);
    const labels = (stored?.options as { id: string; label: string; color?: string; order: number }[]);
    expect(labels.map((o) => o.id)).toEqual(["사과", "배", "새 라벨A", "새 라벨B"]);
    expect(labels[0]).toMatchObject({ id: "사과", color: "#ff0000", order: 0 });
    expect(labels[2].order).toBe(2);
    expect(labels[3].order).toBe(3);
    expect((stored as Record<string, unknown>).meta_version).toBe(7);
  });

  it("정규화 중복은 쓰지 않고 기존 id를 돌려준다", async () => {
    const dup = await db.query<{ option_id: string; created: boolean; replayed: boolean }>(
      append(ids.colNormal, ids.req(3), "  사과 "));
    expect(dup.rows[0]).toEqual({ option_id: "사과", created: false, replayed: false });
    const stored = await optionsOf(ids.colNormal);
    expect((stored?.options as unknown[]).length).toBe(2);
    const replay = await db.query<{ option_id: string; replayed: boolean }>(
      append(ids.colNormal, ids.req(3), "  사과 "));
    expect(replay.rows[0].replayed).toBe(true);
  });

  it("같은 열쇠에 다른 내용·다른 행위자는 거절한다", async () => {
    await db.query(append(ids.colNormal, ids.req(4), "고유A"));
    await expect(db.query(append(ids.colNormal, ids.req(4), "고유B"))).rejects.toThrow(/idempotency key reuse/);
    await actor(db, ids.member);
    // member는 column_manage가 없어 권한에서 먼저 떨어진다 — 원장 충돌 이전에 막힌다.
    await expect(db.query(append(ids.colNormal, ids.req(4), "고유A"))).rejects.toThrow(/permission denied/);
  });

  it("테넌트 위조·없는 컬럼은 건드리지 않는다", async () => {
    await actor(db, ids.outsider);
    await expect(db.query(append(ids.colNormal, ids.req(5), "침입"))).rejects.toThrow(/permission denied/);
    await actor(db, ids.owner);
    await expect(db.query(append(ids.colNormal, ids.req(6), "침입", ids.orgA, ids.boardB)))
      .rejects.toThrow(/column unavailable/);
    const stored = await optionsOf(ids.colNormal);
    expect((stored?.options as unknown[]).length).toBe(2);
  });

  it("보호 컬럼·읽기전용·수식·이동규칙·텍스트형은 DB 경계에서 막힌다", async () => {
    for (const [column, request] of [
      [ids.colStage, 11], [ids.colRegion, 12], [ids.colReadonly, 13],
      [ids.colCalc, 14], [ids.colMoveRule, 15], [ids.colText, 16],
    ] as const) {
      await expect(db.query(append(column, ids.req(request), "새값")))
        .rejects.toThrow(/protected column|not creatable/);
    }
  });

  it("labels 키 모양도 그 자리에서 덧붙이고 권한 없는 편집자는 막힌다", async () => {
    const created = await db.query<{ option_id: string; created: boolean }>(
      append(ids.colLabels, ids.req(21), "새옛값"));
    expect(created.rows[0]).toEqual({ option_id: "새옛값", created: true, replayed: false });
    const stored = await optionsOf(ids.colLabels);
    expect(stored).toHaveProperty("labels");
    expect(stored).not.toHaveProperty("options");
    expect((stored?.labels as { id: string }[]).map((o) => o.id)).toEqual(["옛값", "새옛값"]);
    await actor(db, ids.member);
    await expect(db.query(append(ids.colNormal, ids.req(22), "안돼")))
      .rejects.toThrow(/permission denied/);
  });
  it("system board direct RPC is denied with zero label or receipt writes", async () => {
    await db.exec(`update boards set is_system=true where id='${ids.boardA}'`);
    const before = await optionsOf(ids.colNormal);
    await expect(db.query(append(ids.colNormal, ids.req(31), "system-write"))).rejects.toThrow(/column unavailable/);
    expect(await optionsOf(ids.colNormal)).toEqual(before);
    expect((await db.query<{ n: number }>("select count(*)::int n from board_label_append_requests")).rows[0].n).toBe(0);
  });

  it("revoked current permission denies even a receipt replay without writes", async () => {
    await db.query(append(ids.colNormal, ids.req(32), "before revoke"));
    const before = await optionsOf(ids.colNormal);
    await db.exec(`create or replace function public.effective_permission(p_org uuid,p_key text) returns boolean language sql stable as $$select false$$`);
    await expect(db.query(append(ids.colNormal, ids.req(32), "before revoke"))).rejects.toThrow(/permission denied/);
    expect(await optionsOf(ids.colNormal)).toEqual(before);
  });

});
