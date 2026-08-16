import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../../supabase/migrations/085_workspace_join_digest_schema.sql", import.meta.url),
  "utf8",
);

const id = (value: number): string =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

describe("BBE-169 workspace join digest schema repair", () => {
  const opened: PGlite[] = [];
  afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())));

  it("creates one pending request and event, replays safely, and keeps the RPC authenticated-only", async () => {
    const db = new PGlite();
    opened.push(db);
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create schema extensions;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
      create function extensions.digest(bytea, text) returns bytea language sql immutable as
        $$ select decode(md5(encode($1, 'hex') || $2), 'hex') $$;

      create table public.users(id uuid primary key);
      create table public.orgs(id uuid primary key, slug text not null unique);
      create table public.org_members(
        org_id uuid not null,
        user_id uuid not null,
        status text not null,
        primary key(org_id, user_id)
      );
      create table public.workspace_invite_codes(
        id uuid primary key,
        org_id uuid not null,
        code_digest bytea not null,
        revoked_at timestamptz,
        expires_at timestamptz not null,
        use_count integer not null default 0,
        use_limit integer not null default 1
      );
      create table public.workspace_entry_requests(
        id uuid primary key,
        requester_user_id uuid not null,
        kind text not null,
        status text not null,
        target_org_id uuid,
        invite_code_id uuid,
        lookup_digest bytea,
        payload_digest bytea not null,
        created_at timestamptz not null,
        review_expires_at timestamptz not null,
        decision_code text,
        resolved_by uuid,
        resolved_at timestamptz
      );
      create table public.workspace_entry_events(
        id bigint generated always as identity primary key,
        request_id uuid not null,
        org_id uuid,
        actor_user_id uuid,
        event_type text not null,
        outcome text not null,
        metadata jsonb not null
      );
      create function public.workspace_lookup_digest(text) returns bytea
        language sql immutable strict set search_path=public,extensions,pg_temp as
        $$ select extensions.digest(convert_to(lower(btrim($1)), 'utf8'), 'sha256') $$;

      insert into public.users values ('${id(1)}');
      insert into public.orgs values ('${id(10)}', 'qa-workspace');
    `);
    await db.exec(migration);
    await db.exec(migration);
    await db.exec(`select set_config('app.uid', '${id(1)}', false); set role authenticated;`);

    const first = await db.query<{ accepted: boolean }>(
      `select (public.submit_workspace_join_request('${id(20)}', 'qa-workspace')->>'accepted')::boolean accepted`,
    );
    const replay = await db.query<{ accepted: boolean }>(
      `select (public.submit_workspace_join_request('${id(20)}', 'qa-workspace')->>'accepted')::boolean accepted`,
    );
    expect(first.rows[0].accepted).toBe(true);
    expect(replay.rows[0].accepted).toBe(true);
    await db.exec("reset role");

    const counts = await db.query<{ requests: number; events: number; targets: number }>(`
      select
        (select count(*)::int from public.workspace_entry_requests) requests,
        (select count(*)::int from public.workspace_entry_events where event_type='join_request_submitted') events,
        (select count(*)::int from public.workspace_entry_requests where target_org_id='${id(10)}') targets
    `);
    expect(counts.rows[0]).toEqual({ requests: 1, events: 1, targets: 1 });

    const acl = await db.query<{ auth: boolean; anon: boolean; service: boolean; public: boolean }>(`
      select
        has_function_privilege('authenticated','public.submit_workspace_join_request(uuid,text)','execute') auth,
        has_function_privilege('anon','public.submit_workspace_join_request(uuid,text)','execute') anon,
        has_function_privilege('service_role','public.submit_workspace_join_request(uuid,text)','execute') service,
        has_function_privilege('public','public.submit_workspace_join_request(uuid,text)','execute') public
    `);
    expect(acl.rows[0]).toEqual({ auth: true, anon: false, service: false, public: false });
  });

  it("contains only the hosted schema qualification as the function-body contract change", () => {
    expect(migration).toContain("extensions.digest(");
    expect(migration).not.toMatch(/\bv_payload_digest\s*:=\s*digest\(/u);
    expect(migration).not.toMatch(/\b(update|delete)\s+public\.(?:users|orgs|org_members)\b/iu);
    expect(migration).toContain("set search_path = public, pg_temp");
  });
});
