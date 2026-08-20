import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { parseTodayDashboard } from "./today";

const migration = readFileSync(
  new URL("../../../../supabase/migrations/086_dashboard_daily_read_model.sql", import.meta.url),
  "utf8",
);
// ★ BBE-215: 086 뒤에 098 을 얹어 «현재» 읽기 모델을 잰다.
//   086 만 심으면 이 파일은 «이미 갈아치운 정의» 를 지키게 되고, 그건 지나간 계약이다.
const migration215 = readFileSync(
  new URL("../../../../supabase/migrations/099_bbe215_today_kpi_definitions.sql", import.meta.url),
  "utf8",
);
const id = (value: number): string => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

describe("BBE-185 today dashboard RPC", () => {
  const opened: PGlite[] = [];
  afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())));

  async function setup(): Promise<PGlite> {
    const db = new PGlite(); opened.push(db);
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
      create table orgs(id uuid primary key, status text not null);
      create table users(id uuid primary key);
      create table org_members(org_id uuid, user_id uuid, role text, scope text, status text, primary key(org_id,user_id));
      create table boards(id uuid primary key, org_id uuid, source text);
      create table items(id uuid primary key, org_id uuid, board_id uuid, title text, assigned_to uuid);
      create table item_values(org_id uuid, item_id uuid, column_key text, value_jsonb jsonb, primary key(item_id,column_key));
      create table work_item_versions(org_id uuid, item_id uuid primary key, due_date date, workflow_status text);
      create table notifications(id uuid primary key, org_id uuid, user_id uuid, type text, title text, body text,
        target_type text, target_id uuid, is_action boolean, read_at timestamptz, resolved_at timestamptz, created_at timestamptz);
      create table onboarding_quest_defs(quest_key text primary key, sort_order int default 0);
      create table onboarding_quest_progress(org_id uuid, quest_key text, completed_at timestamptz default now(), primary key(org_id, quest_key));
      create function begin_guarded_migration(
        p_logical_key text, p_file_name text, p_file_digest text,
        p_expected_predecessor text, p_executor text, p_thread_id text, p_foundation boolean
      ) returns void language sql as $$ select $$;
      create function effective_permission(p_org uuid, p_key text) returns boolean language sql stable as $$
        select p_key='work.view_tabs' and exists(select 1 from org_members where org_id=p_org and user_id=auth.uid() and status='active') $$;
      grant usage on schema public to authenticated;
      insert into orgs values ('${id(1)}','active'),('${id(2)}','active');
      insert into users values ('${id(10)}'),('${id(11)}'),('${id(12)}'),('${id(13)}');
      insert into org_members values
        ('${id(1)}','${id(10)}','owner','all','active'),('${id(1)}','${id(11)}','member','assigned','active'),
        ('${id(1)}','${id(12)}','member','all','active'),('${id(2)}','${id(13)}','owner','all','active');
      insert into boards values
        ('${id(20)}','${id(1)}','core.default-tab/contact'),('${id(21)}','${id(1)}','core.default-tab/contract-work'),
        ('${id(22)}','${id(2)}','core.default-tab/contact'),('${id(23)}','${id(2)}','core.default-tab/contract-work'),
        ('${id(24)}','${id(1)}','core.default-tab/new-lead'),('${id(25)}','${id(2)}','core.default-tab/new-lead');
      insert into items values
        ('${id(30)}','${id(1)}','${id(20)}','Owner contact','${id(10)}'),
        ('${id(31)}','${id(1)}','${id(20)}','Member contact','${id(11)}'),
        ('${id(32)}','${id(1)}','${id(21)}','Owner task','${id(10)}'),
        ('${id(33)}','${id(1)}','${id(21)}','Member task','${id(11)}'),
        ('${id(34)}','${id(2)}','${id(22)}','Other org','${id(13)}');
      insert into item_values values
        ('${id(1)}','${id(30)}','meeting_at','"2026-08-16T15:30:00Z"'),
        ('${id(1)}','${id(30)}','recontact_on','"2026-08-16"'),
        ('${id(1)}','${id(30)}','contract_status','"waiting"'),
        ('${id(1)}','${id(31)}','meeting_at','"2026-08-17T10:00:00+09:00"'),
        ('${id(1)}','${id(31)}','recontact_on','"2026-08-17"'),
        ('${id(1)}','${id(31)}','contract_status','"waiting"'),
        ('${id(1)}','${id(32)}','contract_deposit','1000'),
        ('${id(1)}','${id(32)}','contract_deposit_paid_on','"2026-08-01"'),
        ('${id(1)}','${id(32)}','fee_amount','200'),
        ('${id(1)}','${id(32)}','fee_paid_on','"2026-08-31"'),
        ('${id(1)}','${id(33)}','contract_deposit','3000'),
        ('${id(1)}','${id(33)}','contract_deposit_paid_on','"2026-09-01"'),
        ('${id(2)}','${id(34)}','meeting_at','"2026-08-17T10:00:00+09:00"');
      insert into work_item_versions values
        ('${id(1)}','${id(32)}','2026-08-16','in_progress'),('${id(1)}','${id(33)}','2026-08-17','not_started');
      insert into notifications values
        ('${id(40)}','${id(1)}','${id(10)}','work','Own alert',null,'board_item','${id(32)}',true,null,null,'2026-08-17T00:00:00Z'),
        ('${id(41)}','${id(1)}','${id(11)}','work','Member alert',null,null,null,false,null,null,'2026-08-17T00:01:00Z'),
        ('${id(42)}','${id(2)}','${id(13)}','work','Foreign alert',null,null,null,false,null,null,'2026-08-17T00:02:00Z');
      select set_config('app.uid','${id(10)}',false);
    `);
    await db.exec(migration);
    await db.exec(migration215); return db;
  }

  it("returns an exact owner snapshot, KST month boundary, canonical notifications, and replay-safe reads", async () => {
    const db = await setup();
    const sql = `select public.read_today_dashboard('${id(1)}','2026-08-17T03:00:00Z') snapshot`;
    const first = (await db.query<{ snapshot: unknown }>(sql)).rows[0].snapshot;
    const second = (await db.query<{ snapshot: unknown }>(sql)).rows[0].snapshot;
    expect(second).toEqual(first);
    const parsed = parseTodayDashboard(first);
    // ★ BBE-215 로 정의가 바뀌었다. 이 픽스처는 consult_status 를 안 심고 contract_status 가
    //   "waiting"(새 허용목록 「계약서 요청」·「계약서 작성완료」 밖) 이라 앞의 넷이 0 이다.
    //   금액 둘은 정의가 안 바뀌었으므로 그대로다 — 그게 「안 바꿨다」의 증거다.
    expect(parsed.kpis).toEqual({
      calls: 0, callbacks: 0, meetings: 0, contractsWaiting: 0, contractDeposits: 1000, fees: 200,
    });
    expect(parsed.status, "consult_status 가 통째로 비었다").toBe("unfilled");
    expect(parsed.unfilledColumns).toContain("consult_status");
    expect(parsed.tasks.map((task) => task.itemId)).toEqual([id(32), id(33)]);
    expect(parsed.notifications.map((notification) => notification.title)).toEqual(["Own alert"]);
    expect(parsed.tasks.every((task) => task.href.startsWith("/work?notification="))).toBe(true);
    expect(parsed.period).toEqual({ today: "2026-08-17", monthStart: "2026-08-01", monthEndExclusive: "2026-09-01" });
  });

  it("marks a snapshot partial when either independent CRM source is missing", async () => {
    const db = await setup();
    await db.exec(`delete from boards where id='${id(24)}'`);
    const parsed = parseTodayDashboard((await db.query<{ snapshot: unknown }>(
      `select public.read_today_dashboard('${id(1)}','2026-08-17T03:00:00Z') snapshot`,
    )).rows[0].snapshot);
    expect(parsed.status).toBe("partial");
    expect(parsed.missingSources).toEqual(["new-lead"]);
  });

  it("enforces assigned/all scope and cross-organization isolation", async () => {
    const db = await setup();
    await db.exec(`select set_config('app.uid','${id(11)}',false)`);
    const assigned = parseTodayDashboard((await db.query<{ snapshot: unknown }>(
      `select public.read_today_dashboard('${id(1)}','2026-08-17T03:00:00Z') snapshot`,
    )).rows[0].snapshot);
    expect(assigned.kpis).toMatchObject({ calls: 0, callbacks: 0, meetings: 0, contractsWaiting: 0, contractDeposits: 0, fees: 0 });
    expect(assigned.tasks.map((task) => task.itemId)).toEqual([id(33)]);
    expect(JSON.stringify(assigned)).not.toContain(id(32));
    await expect(db.query(`select public.read_today_dashboard('${id(2)}','2026-08-17T03:00:00Z')`)).rejects.toThrow(/membership|required/u);
    await db.exec(`select set_config('app.uid','${id(12)}',false)`);
    const all = parseTodayDashboard((await db.query<{ snapshot: unknown }>(
      `select public.read_today_dashboard('${id(1)}','2026-08-17T03:00:00Z') snapshot`,
    )).rows[0].snapshot);
    expect(all.tasks).toHaveLength(2);
    expect(JSON.stringify(all)).not.toContain("Foreign alert");
  });

  it("is idempotent and exposes only the authenticated RPC grant", async () => {
    const db = await setup(); await db.exec(migration);
    const acl = (await db.query<{ public_exec: boolean; anon_exec: boolean; auth_exec: boolean; service_exec: boolean }>(`select
      has_function_privilege('public','public.read_today_dashboard(uuid,timestamp with time zone)','execute') public_exec,
      has_function_privilege('anon','public.read_today_dashboard(uuid,timestamp with time zone)','execute') anon_exec,
      has_function_privilege('authenticated','public.read_today_dashboard(uuid,timestamp with time zone)','execute') auth_exec,
      has_function_privilege('service_role','public.read_today_dashboard(uuid,timestamp with time zone)','execute') service_exec
    `)).rows[0];
    expect(acl).toEqual({ public_exec: false, anon_exec: false, auth_exec: true, service_exec: false });
  });
});
