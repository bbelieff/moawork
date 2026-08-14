import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dependencyRoot = process.env.PGLITE_MODULE_ROOT ?? root;
const { PGlite } = await import(pathToFileURL(path.join(
  dependencyRoot, "node_modules", "@electric-sql", "pglite", "dist", "index.js",
)).href);

const ORG = "00000000-0000-0000-0000-000000000001";
const AUTHOR = "00000000-0000-0000-0000-000000000002";
const OTHER = "00000000-0000-0000-0000-000000000003";
const DEAL = "00000000-0000-0000-0000-000000000004";

async function bootstrap(db) {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;

    create table public.users(id uuid primary key, name text);
    create table public.org_members(
      org_id uuid not null, user_id uuid not null,
      role text not null default 'member', scope text not null default 'assigned'
    );
    create table public.deals(
      id uuid primary key, org_id uuid not null, assigned_to uuid,
      custom jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now()
    );
    create table public.notifications(
      id uuid primary key default gen_random_uuid(), org_id uuid not null, user_id uuid not null,
      type text not null, title text not null, body text, target_type text, target_id uuid,
      actor_id uuid, is_action boolean not null default false
    );
    create table public.activities(
      id uuid primary key default gen_random_uuid(), org_id uuid not null, deal_id uuid,
      type text not null, content text, actor uuid, at timestamptz not null default now()
    );
    create table public.app_meta(
      key text primary key, value text not null, updated_at timestamptz not null default now()
    );
    create function public.is_org_member(p_org_id uuid) returns boolean
      language sql stable security invoker as
      $$ select exists(select 1 from public.org_members where org_id=p_org_id and user_id=auth.uid()) $$;

    alter table public.deals enable row level security;
    create policy deal_member_read on public.deals for select to authenticated
      using (public.is_org_member(org_id));
    create policy deal_member_update on public.deals for update to authenticated
      using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
    grant select, update on public.deals to authenticated;
    grant select on public.org_members to authenticated;

    insert into public.users(id,name) values ('${AUTHOR}','Author'), ('${OTHER}','Other');
    insert into public.org_members(org_id,user_id,role,scope) values
      ('${ORG}','${AUTHOR}','owner','all'), ('${ORG}','${OTHER}','member','assigned');
    insert into public.deals(id,org_id,custom) values (
      '${DEAL}', '${ORG}',
      '{"comments":[{"id":"c1","author_id":"${AUTHOR}","body":"v1","created_at":"2026-01-01T00:00:00.000Z","edited_at":null,"edit_history":[],"version":1}]}'::jsonb
    );
  `);
}

test("BBE-16 atomic comment edit rejects stale and non-author writes", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    const sql = await readFile(path.join(root, "supabase", "migrations", "064_deal_collab_notify.sql"), "utf8");
    await db.exec(sql);

    await db.exec(`set role authenticated; select set_config('app.user_id','${AUTHOR}',false);`);
    const first = await db.query(
      "select public.edit_deal_comment_atomic($1,$2,$3,$4,$5) as ok",
      [ORG, DEAL, "c1", "v2", 1],
    );
    assert.equal(first.rows[0].ok, true);

    const stale = await db.query(
      "select public.edit_deal_comment_atomic($1,$2,$3,$4,$5) as ok",
      [ORG, DEAL, "c1", "stale overwrite", 1],
    );
    assert.equal(stale.rows[0].ok, false);

    await db.exec(`select set_config('app.user_id','${OTHER}',false);`);
    const nonAuthor = await db.query(
      "select public.edit_deal_comment_atomic($1,$2,$3,$4,$5) as ok",
      [ORG, DEAL, "c1", "other user's overwrite", 2],
    );
    assert.equal(nonAuthor.rows[0].ok, false);

    await db.exec(`select set_config('app.user_id','${AUTHOR}',false);`);
    const stored = await db.query(
      "select custom->'comments'->0 as comment from public.deals where id=$1",
      [DEAL],
    );
    assert.equal(stored.rows[0].comment.body, "v2");
    assert.equal(stored.rows[0].comment.version, 2);
    assert.equal(stored.rows[0].comment.edit_history[0].body, "v1");
  } finally {
    await db.close();
  }
});

test("BBE-16 follow-up RPC reports no assignee, self, and sent as distinct outcomes", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    const sql = await readFile(path.join(root, "supabase", "migrations", "064_deal_collab_notify.sql"), "utf8");
    await db.exec(sql);
    await db.exec(`set role authenticated; select set_config('app.user_id','${AUTHOR}',false);`);

    const none = await db.query("select public.request_deal_followup($1,$2) as outcome", [ORG, DEAL]);
    assert.equal(none.rows[0].outcome, "no_assignee");

    await db.query("update public.deals set assigned_to=$1 where id=$2", [AUTHOR, DEAL]);
    const self = await db.query("select public.request_deal_followup($1,$2) as outcome", [ORG, DEAL]);
    assert.equal(self.rows[0].outcome, "self_assigned");

    await db.query("update public.deals set assigned_to=$1 where id=$2", [OTHER, DEAL]);
    const sent = await db.query("select public.request_deal_followup($1,$2) as outcome", [ORG, DEAL]);
    assert.equal(sent.rows[0].outcome, "sent");
    await db.exec("reset role");
    const requested = await db.query(
      "select count(*)::int as n from public.notifications where type='requested' and user_id=$1",
      [OTHER],
    );
    assert.equal(requested.rows[0].n, 1);
  } finally {
    await db.close();
  }
});

test("BBE-16 reassignment rolls back the deal when activity insertion fails", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    const sql = await readFile(path.join(root, "supabase", "migrations", "064_deal_collab_notify.sql"), "utf8");
    await db.exec(sql);
    await db.exec(`
      set role authenticated;
      select set_config('app.user_id','${AUTHOR}',false);
      update public.deals set assigned_to='${AUTHOR}' where id='${DEAL}';
      reset role;
      create function public.reject_assignment_activity() returns trigger language plpgsql as $$
      begin
        if new.type = 'assignment' then raise exception 'forced activity failure'; end if;
        return new;
      end $$;
      create trigger reject_assignment_activity before insert on public.activities
        for each row execute function public.reject_assignment_activity();
      set role authenticated;
      select set_config('app.user_id','${AUTHOR}',false);
    `);

    await assert.rejects(
      db.query("select public.reassign_deal_with_activity($1,$2,$3)", [
        ORG,
        DEAL,
        OTHER,
      ]),
      /forced activity failure/,
    );
    await db.exec("reset role");
    const stored = await db.query("select assigned_to from public.deals where id=$1", [DEAL]);
    assert.equal(stored.rows[0].assigned_to, AUTHOR);
    const activities = await db.query("select count(*)::int as n from public.activities");
    assert.equal(activities.rows[0].n, 0);
  } finally {
    await db.close();
  }
});
