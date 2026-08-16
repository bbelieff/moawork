import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  new URL("../../../../supabase/migrations/077_automation_onboarding_quests.sql", import.meta.url),
  "utf8",
);
const automationFoundationRepair = readFileSync(
  new URL("../../../../supabase/migrations/078_automation_conditions_foundation_repair.sql", import.meta.url),
  "utf8",
);

const id = (value: number): string => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

describe("BBE-113 automation onboarding migration", () => {
  const opened: PGlite[] = [];
  afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())));

  async function setup(): Promise<PGlite> {
    const db = new PGlite();
    opened.push(db);
    await db.exec(`
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.users(id uuid primary key);
      create table public.orgs(id uuid primary key);
      create table public.org_members(org_id uuid, user_id uuid, role text, status text, primary key(org_id,user_id));
      create function public.is_org_member(p_org_id uuid) returns boolean language sql stable as
        $$ select exists(select 1 from public.org_members where org_id=p_org_id and user_id=auth.uid() and status='active') $$;
      create function public.org_role(p_org_id uuid) returns text language sql stable as
        $$ select role from public.org_members where org_id=p_org_id and user_id=auth.uid() and status='active' $$;
      create table public.boards(id uuid primary key, org_id uuid not null references public.orgs(id), name text not null);
      create table public.board_groups(id uuid primary key, org_id uuid not null references public.orgs(id), board_id uuid not null references public.boards(id), name text not null, sort_order integer not null);
      create table public.board_columns(id uuid primary key, org_id uuid not null references public.orgs(id), board_id uuid not null references public.boards(id), key text not null, label text not null, sort_order integer not null);
      create table public.board_automation_rules(
        id uuid primary key,
        org_id uuid not null references public.orgs(id),
        board_id uuid not null references public.boards(id),
        status_column_key text not null,
        status_value text not null,
        to_group_id uuid not null references public.board_groups(id),
        enabled boolean not null default true,
        created_at timestamptz not null default now()
      );
      create table public.board_automation_execution_requests(
        execution_key text primary key,
        org_id uuid not null references public.orgs(id),
        rule_id uuid not null references public.board_automation_rules(id),
        state text not null,
        terminal_at timestamptz
      );
      create table public.audit_logs(
        id uuid primary key default gen_random_uuid(),
        org_id uuid not null references public.orgs(id),
        actor uuid references public.users(id),
        action text not null,
        target_type text,
        target_id uuid,
        meta jsonb,
        at timestamptz not null default now()
      );
    `);
    await db.exec(automationFoundationRepair);
    await db.exec(automationFoundationRepair);
    await db.exec(migration);
    await db.exec(`
      insert into public.users values ('${id(1)}'),('${id(2)}');
      insert into public.orgs values ('${id(10)}'),('${id(20)}');
      insert into public.org_members values
        ('${id(10)}','${id(1)}','owner','active'),
        ('${id(20)}','${id(2)}','owner','active');
      insert into public.boards values ('${id(30)}','${id(10)}','리드 컨택');
      insert into public.board_groups values
        ('${id(40)}','${id(10)}','${id(30)}','2차 상담 고객',20),
        ('${id(41)}','${id(10)}','${id(30)}','승인 고객',30);
      insert into public.board_columns values
        ('${id(50)}','${id(10)}','${id(30)}','status','상담 상황',1);
      insert into public.board_automation_rules(id,org_id,board_id,status_column_key,status_value,trigger_label_id,to_group_id,created_at)
      values
        ('${id(60)}','${id(10)}','${id(30)}','status','2차 상담예약','label:second','${id(40)}',now()-interval '2 hours'),
        ('${id(61)}','${id(10)}','${id(30)}','status','승인','label:approved','${id(41)}',now()-interval '2 hours');
      select set_config('app.uid','${id(1)}',false);
    `);
    return db;
  }

  it("syncs, orders and replays without duplicate writes or loops", async () => {
    const db = await setup();
    const generated = await db.query<{ count: number }>("select count(*)::int count from public.onboarding_automation_quests");
    expect(generated.rows[0].count).toBe(2);
    const first = await db.query<{ result: Array<{ ruleId: string; title: string; sortOrder: number }> }>(
      `select public.sync_my_automation_onboarding_quests('${id(10)}') as result`,
    );
    expect(first.rows[0].result.map((quest) => quest.ruleId)).toEqual([id(60), id(61)]);
    expect(first.rows[0].result[0]).toMatchObject({ title: "상담 상황을(를) “2차 상담예약” 상태로 바꾸기", sortOrder: 20001 });

    await db.query(`select public.sync_my_automation_onboarding_quests('${id(10)}')`);
    const audit = await db.query<{ count: number }>("select count(*)::int count from public.audit_logs where action='onboarding.automation_quest_generated'");
    expect(audit.rows[0].count).toBe(2);
    const replayAudit = await db.query<{ count: number }>("select count(*)::int count from public.audit_logs where action='onboarding.automation_quests_synced'");
    expect(replayAudit.rows[0].count).toBe(0);
  });

  it("follows rule changes and only accepts a success from the current rule version", async () => {
    const db = await setup();
    await db.query(`select public.sync_my_automation_onboarding_quests('${id(10)}')`);
    await db.exec(`insert into public.board_automation_execution_requests values ('old-success','${id(10)}','${id(60)}','succeeded',now()-interval '1 hour')`);
    const before = await db.query<{ result: Array<{ ruleId: string; completed: boolean }> }>(`select public.sync_my_automation_onboarding_quests('${id(10)}') result`);
    expect(before.rows[0].result.find((quest) => quest.ruleId === id(60))?.completed).toBe(true);

    await db.exec(`update public.board_automation_rules set status_value='3차 상담예약' where id='${id(60)}'`);
    const changed = await db.query<{ result: Array<{ ruleId: string; title: string; completed: boolean }> }>(`select public.sync_my_automation_onboarding_quests('${id(10)}') result`);
    expect(changed.rows[0].result.find((quest) => quest.ruleId === id(60))).toMatchObject({
      title: "상담 상황을(를) “3차 상담예약” 상태로 바꾸기",
      completed: false,
    });
  });

  it("lets an admin hide or explain a quest without disabling the automation rule", async () => {
    const db = await setup();
    await db.query(`select public.sync_my_automation_onboarding_quests('${id(10)}')`);
    await db.query(`select public.update_my_automation_onboarding_quest('${id(10)}','${id(60)}',true,'승인자 인계 공백을 막아요')`);

    const result = await db.query<{ result: Array<{ ruleId: string; hidden: boolean; why: string }> }>(`select public.sync_my_automation_onboarding_quests('${id(10)}') result`);
    expect(result.rows[0].result.find((quest) => quest.ruleId === id(60))).toMatchObject({ hidden: true, why: "승인자 인계 공백을 막아요" });
    const rule = await db.query<{ enabled: boolean }>(`select enabled from public.board_automation_rules where id='${id(60)}'`);
    expect(rule.rows[0].enabled).toBe(true);
  });

  it("rejects cross-organization replay and leaves all quest rows unchanged", async () => {
    const db = await setup();
    await db.query(`select public.sync_my_automation_onboarding_quests('${id(10)}')`);
    const before = await db.query<{ count: number }>("select count(*)::int count from public.onboarding_automation_quests");
    await db.exec(`select set_config('app.uid','${id(2)}',false)`);
    await expect(db.query(`select public.sync_my_automation_onboarding_quests('${id(10)}')`)).rejects.toThrow(/organization unavailable/u);
    const after = await db.query<{ count: number }>("select count(*)::int count from public.onboarding_automation_quests");
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("isolates a removed display column and keeps the other generated quests available", async () => {
    const db = await setup();
    await db.exec(`update public.board_automation_rules set status_column_key='removed_status' where id='${id(61)}'`);
    const result = await db.query<{ result: Array<{ ruleId: string; title: string }> }>(`select public.sync_my_automation_onboarding_quests('${id(10)}') result`);
    expect(result.rows[0].result).toHaveLength(2);
    expect(result.rows[0].result.find((quest) => quest.ruleId === id(60))?.title).toContain("상담 상황");
    expect(result.rows[0].result.find((quest) => quest.ruleId === id(61))?.title).toContain("removed_status");
  });
});
