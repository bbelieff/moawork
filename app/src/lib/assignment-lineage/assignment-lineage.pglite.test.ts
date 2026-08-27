import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";
import { PGlite } from "@electric-sql/pglite";
import { PGliteWorker } from "@electric-sql/pglite/worker";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "../supabase/migrations/134_issue599_assignment_lineage_core.sql"), "utf8");

const id = {
  orgA: "00000000-0000-4000-8000-000000000001",
  orgB: "00000000-0000-4000-8000-000000000002",
  ownerA: "10000000-0000-4000-8000-000000000001",
  adminA: "10000000-0000-4000-8000-000000000002",
  memberA: "10000000-0000-4000-8000-000000000003",
  watcherA: "10000000-0000-4000-8000-000000000004",
  inactiveA: "10000000-0000-4000-8000-000000000005",
  ownerB: "10000000-0000-4000-8000-000000000006",
  dealA: "20000000-0000-4000-8000-000000000001",
  dealB: "20000000-0000-4000-8000-000000000002",
  dealCross: "20000000-0000-4000-8000-000000000003",
  boardA: "30000000-0000-4000-8000-000000000001",
  boardB: "30000000-0000-4000-8000-000000000002",
  boardCross: "30000000-0000-4000-8000-000000000003",
  itemA: "40000000-0000-4000-8000-000000000001",
  itemB: "40000000-0000-4000-8000-000000000002",
  itemCross: "40000000-0000-4000-8000-000000000003",
};
const request = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const projection = (
  orgId = id.orgA,
  boardId = id.boardA,
  dealId = id.dealA,
  itemId = id.itemA,
) => `'${orgId}','${boardId}','${dealId}','${itemId}'`;

const schema = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid',true),'')::uuid $$;
create table public.migration_apply_guard(logical_key text primary key);
create function public.begin_guarded_migration(
  p_logical_key text,p_file_name text,p_file_digest text,p_expected_predecessor text,
  p_executor text,p_thread_id text,p_foundation boolean
) returns void language plpgsql as $$ begin insert into public.migration_apply_guard values(p_logical_key); end $$;
create table public.orgs(id uuid primary key,status text not null default 'active');
create table public.users(id uuid primary key);
create table public.org_members(
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null,scope text not null default 'assigned',status text not null default 'active',
  primary key(org_id,user_id)
);
create table public.deals(
  id uuid primary key,org_id uuid not null references public.orgs(id) on delete cascade,
  assigned_to uuid references public.users(id),title text not null,updated_at timestamptz not null default now()
);
create table public.items(
  id uuid primary key,org_id uuid not null references public.orgs(id) on delete cascade,
  board_id uuid not null,deal_id uuid,assigned_to uuid references public.users(id),title text not null,
  updated_at timestamptz not null default now(),deleted_at timestamptz
);
create unique index items_one_live_deal_idx on public.items(org_id,deal_id) where deal_id is not null and deleted_at is null;
create table public.item_values(
  org_id uuid not null references public.orgs(id) on delete cascade,item_id uuid not null references public.items(id) on delete cascade,
  column_key text not null,value_jsonb jsonb,primary key(item_id,column_key)
);
create table public.notifications(
  id uuid primary key default gen_random_uuid(),org_id uuid not null,user_id uuid not null,type text not null,title text not null,
  body text,target_type text,target_id uuid,actor_id uuid,is_action boolean not null default false,
  read_at timestamptz,resolved_at timestamptz,created_at timestamptz not null default now(),dedupe_key text
);
create unique index notifications_recipient_dedupe_idx on public.notifications(org_id,user_id,dedupe_key) where dedupe_key is not null;
create function public.effective_permission(p_org_id uuid,p_scope_key text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.org_members m join public.orgs o on o.id=m.org_id
    where m.org_id=p_org_id and m.user_id=auth.uid() and m.status='active' and o.status='active')
$$;
grant usage on schema public,auth to authenticated;
grant execute on function auth.uid(),public.effective_permission(uuid,text) to authenticated;
insert into public.orgs(id) values ('${id.orgA}'),('${id.orgB}');
insert into public.users(id) values ('${id.ownerA}'),('${id.adminA}'),('${id.memberA}'),('${id.watcherA}'),('${id.inactiveA}'),('${id.ownerB}');
insert into public.org_members(org_id,user_id,role,scope,status) values
 ('${id.orgA}','${id.ownerA}','owner','all','active'),
 ('${id.orgA}','${id.adminA}','admin','all','active'),
 ('${id.orgA}','${id.memberA}','member','assigned','active'),
 ('${id.orgA}','${id.watcherA}','member','assigned','active'),
 ('${id.orgA}','${id.inactiveA}','member','assigned','disabled'),
 ('${id.orgB}','${id.ownerB}','owner','all','active');
insert into public.deals(id,org_id,assigned_to,title) values
 ('${id.dealA}','${id.orgA}','${id.ownerA}','A'),
 ('${id.dealCross}','${id.orgA}','${id.ownerA}','A-cross'),
 ('${id.dealB}','${id.orgB}','${id.ownerB}','B');
insert into public.items(id,org_id,board_id,deal_id,assigned_to,title) values
 ('${id.itemA}','${id.orgA}','${id.boardA}','${id.dealA}','${id.ownerA}','A'),
 ('${id.itemCross}','${id.orgA}','${id.boardCross}','${id.dealCross}','${id.ownerA}','A-cross'),
 ('${id.itemB}','${id.orgB}','${id.boardB}','${id.dealB}','${id.ownerB}','B');
insert into public.item_values(org_id,item_id,column_key,value_jsonb) values
 ('${id.orgA}','${id.itemA}','owner',to_jsonb('${id.ownerA}'::text)),
 ('${id.orgA}','${id.itemCross}','owner',to_jsonb('${id.ownerA}'::text)),
 ('${id.orgB}','${id.itemB}','owner',to_jsonb('${id.ownerB}'::text));
`;

const databases: PGlite[] = [];
const workerDatabases: PGliteWorker[] = [];
afterEach(async () => {
  await Promise.all(workerDatabases.splice(0).map((db) => db.close()));
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

function asWebWorker(nodeWorker: NodeWorker): Worker {
  const listeners = new Map<EventListenerOrEventListenerObject, (data: unknown) => void>();
  return {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
      if (type !== "message") return;
      const callback = (data: unknown) => {
        if (typeof listener === "function") listener({ data } as MessageEvent);
        else listener.handleEvent({ data } as MessageEvent);
        if (typeof options === "object" && options.once) nodeWorker.off("message", callback);
      };
      listeners.set(listener, callback);
      nodeWorker.on("message", callback);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      if (type !== "message") return;
      const callback = listeners.get(listener);
      if (callback) nodeWorker.off("message", callback);
      listeners.delete(listener);
    },
    postMessage(data: unknown) { nodeWorker.postMessage(data); },
    terminate() { void nodeWorker.terminate(); },
  } as unknown as Worker;
}

async function sharedWorkerClient(databaseId: string) {
  const require = createRequire(import.meta.url);
  const pgliteUrl = pathToFileURL(require.resolve("@electric-sql/pglite")).href;
  const workerUrl = pathToFileURL(require.resolve("@electric-sql/pglite/worker")).href;
  const source = `
    const { parentPort } = require("node:worker_threads");
    globalThis.postMessage = (data) => parentPort.postMessage(data);
    globalThis.addEventListener = (type, listener, options) => {
      if (type !== "message") return;
      const callback = (data) => {
        listener({ data });
        if (options && options.once) parentPort.off("message", callback);
      };
      parentPort.on("message", callback);
    };
    void (async () => {
      const [{ worker }, { PGlite }] = await Promise.all([
        import(${JSON.stringify(workerUrl)}), import(${JSON.stringify(pgliteUrl)})
      ]);
      await worker({ init: (options) => new PGlite(options.dataDir || "memory://") });
    })();
  `;
  const nodeWorker = new NodeWorker(source, { eval: true, stderr: true });
  nodeWorker.stderr?.resume();
  const client = await PGliteWorker.create(asWebWorker(nodeWorker), { id: databaseId });
  workerDatabases.push(client);
  return client;
}

async function boot() {
  const db = new PGlite();
  databases.push(db);
  await db.exec(schema);
  const before = (await db.query("select (select count(*) from deals)::int deals,(select count(*) from items)::int items,(select count(*) from item_values)::int values_count")).rows[0];
  await db.exec(migration);
  return { db, before };
}

async function as<T = Record<string, unknown>>(db: PGlite, userId: string, sql: string) {
  await db.exec(`reset role; select set_config('app.uid','${userId}',false); set role authenticated;`);
  try { return await db.query<T>(sql); }
  finally { await db.exec("reset role"); }
}

async function scalar<T>(db: PGlite, sql: string) {
  return (await db.query<Record<string, T>>(sql)).rows[0];
}

describe("#599 assignment lineage migration", () => {
  it("does not backfill customer rows and reports the current assignee as a read-only baseline", async () => {
    const { db, before } = await boot();
    const after = (await db.query("select (select count(*) from deals)::int deals,(select count(*) from items)::int items,(select count(*) from item_values)::int values_count")).rows[0];
    expect(after).toEqual(before);
    expect((await scalar<number>(db, "select count(*)::int n from assignment_lineage_state")).n).toBe(0);
    const read = await as<{ value: Record<string, unknown> }>(db, id.ownerA,
      `select public.read_assignment_lineage(${projection()}) value`);
    expect(read.rows[0].value).toMatchObject({ baselineAssigneeId: id.ownerA, currentAssigneeId: id.ownerA, version: 0, transitions: [] });
    expect((await scalar<number>(db, "select count(*)::int n from assignment_lineage_state")).n).toBe(0);
  });

  it("atomically changes deal, item, owner projection, one event and active-recipient notifications", async () => {
    const { db } = await boot();
    await as(db, id.ownerA, `select public.set_assignment_follower(${projection()},'${id.watcherA}',true,'${request(1)}')`);
    const call = `select public.reassign_deal_with_lineage(${projection()},'${id.memberA}','${id.ownerA}',0,'${request(2)}') value`;
    const first = await as<{ value: Record<string, unknown> }>(db, id.ownerA, call);
    const replay = await as<{ value: Record<string, unknown> }>(db, id.ownerA, call);
    expect(first.rows[0].value).toMatchObject({ accepted: true, replayed: false, version: 1 });
    expect(replay.rows[0].value).toMatchObject({ accepted: true, replayed: true, version: 1 });
    expect((await db.query(`select d.assigned_to deal_owner,i.assigned_to item_owner,v.value_jsonb#>>'{}' projected
      from deals d join items i on i.deal_id=d.id join item_values v on v.item_id=i.id and v.column_key='owner' where d.id='${id.dealA}'`)).rows[0]).toEqual({
      deal_owner: id.memberA, item_owner: id.memberA, projected: id.memberA,
    });
    expect((await scalar<number>(db, "select count(*)::int n from assignment_transition_events")).n).toBe(1);
    expect((await db.query("select user_id from notifications order by user_id")).rows).toEqual([{ user_id: id.memberA }, { user_id: id.watcherA }]);
  });

  it("rejects request mismatch, stale current/version, cross-org and inactive targets with zero partial change", async () => {
    const { db } = await boot();
    const call = `select public.reassign_deal_with_lineage(${projection()},'${id.memberA}','${id.ownerA}',0,'${request(10)}')`;
    await as(db, id.adminA, call);
    await expect(as(db, id.adminA, call.replace(id.memberA, id.watcherA))).rejects.toThrow(/idempotency key reuse/iu);
    await expect(as(db, id.adminA, `select public.reassign_deal_with_lineage(${projection()},'${id.ownerA}','${id.ownerA}',0,'${request(11)}')`)).rejects.toThrow(/version conflict/iu);
    await expect(as(db, id.adminA, `select public.reassign_deal_with_lineage(${projection()},'${id.ownerB}','${id.memberA}',1,'${request(12)}')`)).rejects.toThrow(/active organization member/iu);
    await expect(as(db, id.adminA, `select public.reassign_deal_with_lineage(${projection()},'${id.inactiveA}','${id.memberA}',1,'${request(13)}')`)).rejects.toThrow(/active organization member/iu);
    await expect(as(db, id.adminA, `select public.reassign_deal_with_lineage(${projection(id.orgA, id.boardA, id.dealCross, id.itemCross)},'${id.memberA}','${id.ownerA}',0,'${request(14)}')`)).rejects.toThrow(/writer required/iu);
    expect((await scalar<number>(db, "select count(*)::int n from assignment_transition_events")).n).toBe(1);
    expect((await db.query(`select assigned_to from deals where id='${id.dealA}'`)).rows).toEqual([{ assigned_to: id.memberA }]);
  });

  it("serializes two independent worker clients so exactly one expected-version write commits", async () => {
    const databaseId = `issue599-${crypto.randomUUID()}`;
    const firstClient = await sharedWorkerClient(databaseId);
    await firstClient.exec(schema);
    await firstClient.exec(migration);
    const secondClient = await sharedWorkerClient(databaseId);
    const competingCall = (assignedTo: string, requestId: string) => `
      with identity as materialized (select set_config('app.uid','${id.ownerA}',false))
      select public.reassign_deal_with_lineage(${projection()},'${assignedTo}','${id.ownerA}',0,'${requestId}')
      from identity`;
    const attempts = await Promise.allSettled([
      firstClient.query(competingCall(id.memberA, request(20))),
      secondClient.query(competingCall(id.watcherA, request(21))),
    ]);
    expect(attempts.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((entry) => entry.status === "rejected")).toHaveLength(1);
    expect((await firstClient.query<{ n: number }>("select count(*)::int n from assignment_transition_events")).rows[0].n).toBe(1);
  });

  it("rolls back every projection and ledger write when the final receipt insert fails", async () => {
    const { db } = await boot();
    await db.exec(`
      create function public.issue599_fail_final_receipt() returns trigger language plpgsql as $$
      begin
        if new.request_id = '${request(25)}' then raise exception 'injected final receipt failure'; end if;
        return new;
      end $$;
      create trigger issue599_fail_final_receipt before insert on public.assignment_lineage_requests
        for each row execute function public.issue599_fail_final_receipt();
    `);
    await expect(as(db, id.ownerA,
      `select public.reassign_deal_with_lineage(${projection()},'${id.memberA}','${id.ownerA}',0,'${request(25)}')`,
    )).rejects.toThrow(/injected final receipt failure/iu);
    expect((await db.query(`select d.assigned_to deal_owner,i.assigned_to item_owner,v.value_jsonb#>>'{}' projected
      from deals d join items i on i.id='${id.itemA}' and i.deal_id=d.id
      join item_values v on v.item_id=i.id and v.column_key='owner' where d.id='${id.dealA}'`)).rows[0]).toEqual({
      deal_owner: id.ownerA, item_owner: id.ownerA, projected: id.ownerA,
    });
    expect(await scalar<number>(db, `select
      (select count(*) from assignment_lineage_state)::int state,
      (select count(*) from assignment_transition_events)::int transitions,
      (select count(*) from assignment_lineage_requests)::int receipts,
      (select count(*) from notifications)::int notifications`)).toEqual({
      state: 0, transitions: 0, receipts: 0, notifications: 0,
    });
  });

  it("keeps handoff events separate and leaves both ledger digests unchanged when a follower is removed", async () => {
    const { db } = await boot();
    await as(db, id.ownerA, `select public.set_assignment_follower(${projection()},'${id.watcherA}',true,'${request(30)}')`);
    const scheduled = await as<{ value: { handoffId: string } }>(db, id.ownerA,
      `select public.schedule_assignment_handoff(${projection()},'${id.memberA}','${id.ownerA}',0,'${request(31)}') value`);
    await as(db, id.ownerA, `select public.reassign_deal_with_lineage(${projection()},'${id.memberA}','${id.ownerA}',0,'${request(32)}')`);
    expect(scheduled.rows[0].value.handoffId).toBeTruthy();
    expect((await scalar<number>(db, "select count(*)::int n from assignment_handoff_events where event_type='executed'")).n).toBe(1);
    const before = await scalar<string>(db, `select md5(coalesce(string_agg(row_to_json(e)::text,'|' order by e.sequence),'')) digest
      from assignment_transition_events e;`);
    const handoffBefore = await scalar<string>(db, `select md5(coalesce(string_agg(row_to_json(e)::text,'|' order by e.created_at,e.id),'')) digest
      from assignment_handoff_events e;`);
    await as(db, id.ownerA, `select public.set_assignment_follower(${projection()},'${id.watcherA}',false,'${request(33)}')`);
    const after = await scalar<string>(db, `select md5(coalesce(string_agg(row_to_json(e)::text,'|' order by e.sequence),'')) digest
      from assignment_transition_events e;`);
    const handoffAfter = await scalar<string>(db, `select md5(coalesce(string_agg(row_to_json(e)::text,'|' order by e.created_at,e.id),'')) digest
      from assignment_handoff_events e;`);
    expect(after.digest).toBe(before.digest);
    expect(handoffAfter.digest).toBe(handoffBefore.digest);
    await as(db, id.ownerA, `select public.reassign_deal_with_lineage(${projection()},'${id.ownerA}','${id.memberA}',1,'${request(34)}')`);
    expect((await scalar<number>(db, `select count(*)::int n from notifications where dedupe_key='assignment:${request(34)}' and user_id='${id.watcherA}'`)).n).toBe(0);
  });

  it("supersedes a stale handoff instead of executing it after an intervening reassignment", async () => {
    const { db } = await boot();
    const scheduled = await as<{ value: { handoffId: string } }>(db, id.ownerA,
      `select public.schedule_assignment_handoff(${projection()},'${id.memberA}','${id.ownerA}',0,'${request(35)}') value`);
    await as(db, id.ownerA,
      `select public.reassign_deal_with_lineage(${projection()},'${id.watcherA}','${id.ownerA}',0,'${request(36)}')`);
    await as(db, id.ownerA,
      `select public.reassign_deal_with_lineage(${projection()},'${id.memberA}','${id.watcherA}',1,'${request(37)}')`);
    expect((await db.query(`select status from assignment_pending_handoffs where id='${scheduled.rows[0].value.handoffId}'`)).rows)
      .toEqual([{ status: "superseded" }]);
    expect((await db.query("select event_type from assignment_handoff_events order by created_at,id")).rows)
      .toEqual([{ event_type: "scheduled" }, { event_type: "superseded" }]);
    expect((await scalar<number>(db, "select count(*)::int n from assignment_handoff_events where event_type='executed'")).n).toBe(0);
    expect((await scalar<number>(db, "select count(*)::int n from assignment_transition_events")).n).toBe(2);
  });

  it("rejects inactive actors and cross-org reads, enforces read RLS, ACL and append-only triggers", async () => {
    const { db } = await boot();
    await expect(as(db, id.inactiveA, `select public.reassign_deal_with_lineage(${projection()},'${id.memberA}','${id.ownerA}',0,'${request(40)}')`)).rejects.toThrow(/writer required/iu);
    await expect(as(db, id.ownerB, `select public.read_assignment_lineage(${projection()})`)).rejects.toThrow(/unavailable/iu);
    await as(db, id.ownerA, `select public.reassign_deal_with_lineage(${projection()},'${id.memberA}','${id.ownerA}',0,'${request(41)}')`);
    expect((await as(db, id.ownerB, "select * from public.assignment_transition_events")).rows).toEqual([]);
    await expect(db.query("update public.assignment_transition_events set sequence=2")).rejects.toThrow(/append-only/iu);
    const acl = await db.query<{ public_exec: boolean; anon_exec: boolean; service_exec: boolean; auth_exec: boolean }>(`select
      has_function_privilege('public','public.reassign_deal_with_lineage(uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid)','execute') public_exec,
      has_function_privilege('anon','public.reassign_deal_with_lineage(uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid)','execute') anon_exec,
      has_function_privilege('service_role','public.reassign_deal_with_lineage(uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid)','execute') service_exec,
      has_function_privilege('authenticated','public.reassign_deal_with_lineage(uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid)','execute') auth_exec`);
    expect(acl.rows[0]).toEqual({ public_exec: false, anon_exec: false, service_exec: false, auth_exec: true });
  });

  it("keeps every SECURITY DEFINER function on a fixed public,pg_temp search path", async () => {
    const { db } = await boot();
    const rows = await db.query<{ proname: string; config: string[] | null }>(`select p.proname,p.proconfig config from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname like 'assignment_%' or n.nspname='public' and p.proname in
      ('read_assignment_lineage','reassign_deal_with_lineage','set_assignment_follower','schedule_assignment_handoff','cancel_assignment_handoff')`);
    expect(rows.rows.length).toBeGreaterThanOrEqual(9);
    for (const row of rows.rows) expect(row.config).toContain("search_path=public, pg_temp");
  });
});
