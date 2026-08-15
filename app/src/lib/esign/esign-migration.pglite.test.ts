import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../supabase/migrations/073_esign_delivery.sql"), "utf8");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("BBE-115 DB contract", () => {
  it("queues once, hands off once, and applies one signed event in tenant scope", async () => {
    const db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role; create role moawork_outbox_worker;
      create schema auth; create schema extensions;
      create function extensions.digest(text,text) returns bytea language sql immutable as $$select decode(md5($1),'hex')$$;
      create type message_channel as enum ('alimtalk','sms'); create type message_status as enum ('queued','sent','failed');
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select current_setting('app.role',true)$$;
      create table orgs(id uuid primary key,status text); create table users(id uuid primary key);
      create table org_members(org_id uuid,user_id uuid,role text,scope text,status text,primary key(org_id,user_id));
      create table deals(id uuid primary key,org_id uuid,assigned_to uuid,custom jsonb default '{}',updated_at timestamptz);
      create table audit_logs(id uuid primary key default gen_random_uuid(),org_id uuid,actor uuid,action text,target_type text,target_id uuid,meta jsonb,at timestamptz default now());
      create table activities(id uuid primary key default gen_random_uuid(),org_id uuid,deal_id uuid,type text,content text,actor uuid,at timestamptz default now());
      create table messages(id uuid primary key default gen_random_uuid(),org_id uuid,template_id uuid,to_addr text,from_addr text,body_snapshot text,status message_status,source_entity_id uuid,channel message_channel,idempotency_key text,trigger_column_key text,trigger_value text,unique(org_id,idempotency_key));
      create table message_outbox(id uuid primary key default gen_random_uuid(),org_id uuid,message_id uuid,idempotency_key text,actor_kind text,actor_id text,unique(org_id,idempotency_key));
      create table message_outbox_audit(id bigint generated always as identity primary key,outbox_id uuid,org_id uuid,event text,actor_kind text,actor_id text,attempt_count integer);
      create function is_org_member(uuid) returns boolean language sql as $$select true$$;
      insert into orgs values('${id(1)}','active'); insert into users values('${id(2)}');
      insert into org_members values('${id(1)}','${id(2)}','member','assigned','active');
      insert into deals values('${id(3)}','${id(1)}','${id(2)}','{}',now());
      select set_config('app.uid','${id(2)}',false),set_config('app.role','authenticated',false);
    `);
    await db.exec(sql);
    const enqueue = `select * from enqueue_esign_request('${id(3)}','tpl','signer','${id(4)}')`;
    expect((await db.query<{ inserted: boolean }>(enqueue)).rows[0].inserted).toBe(true);
    expect((await db.query<{ inserted: boolean }>(enqueue)).rows[0].inserted).toBe(false);
    const requestId = (await db.query<{ id: string }>("select id from esign_requests")).rows[0].id;
    expect((await db.query("select * from start_esign_delivery($1)", [requestId])).rows).toHaveLength(1);
    expect((await db.query("select * from start_esign_delivery($1)", [requestId])).rows).toHaveLength(0);
    await db.query("select mark_esign_provider_accepted($1,$2,$3)", [requestId, "doc-1", "https://sandbox.example/sign"]);
    const resumed = (await db.query<{ provider_document_id: string; provider_signing_url: string }>("select * from start_esign_delivery($1)", [requestId])).rows[0];
    expect(resumed).toMatchObject({ provider_document_id: "doc-1", provider_signing_url: "https://sandbox.example/sign" });
    const handoff = `select * from enqueue_esign_signing_link('${requestId}','${id(5)}','sms','sender','https://sandbox.example/sign')`;
    expect((await db.query<{ inserted: boolean }>(handoff)).rows[0].inserted).toBe(true);
    expect((await db.query<{ inserted: boolean }>(handoff)).rows[0].inserted).toBe(false);
    expect(Number((await db.query<{ count: number }>("select count(*) count from message_outbox")).rows[0].count)).toBe(1);
    expect((await db.query<{ provider_document_id: string }>("select provider_document_id from esign_requests where id=$1", [requestId])).rows[0].provider_document_id).toBe("doc-1");
    await db.query("select mark_esign_awaiting($1,$2)", [requestId, "doc-1"]);
    await db.exec("select set_config('app.role','service_role',false)");
    expect((await db.query<{ r: string }>("select apply_esign_signed_event('evt-1','doc-1','2026-08-15T15:30:00Z') r")).rows[0].r).toBe("applied");
    expect((await db.query<{ r: string }>("select apply_esign_signed_event('evt-1','doc-1','2026-08-15T15:30:00Z') r")).rows[0].r).toBe("duplicate");
    expect((await db.query<{ d: string }>("select custom->>'electronic_contract_date' d from deals")).rows[0].d).toBe("2026-08-16");
    await db.close();
  });
});
