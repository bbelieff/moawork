import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "../supabase/migrations/070_seal_approval_requests.sql"), "utf8");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("BBE-105 seal approval PostgreSQL contract", () => {
  const opened: PGlite[] = [];
  afterEach(async () => Promise.all(opened.splice(0).map((db) => db.close())));

  it("permits the assigned member, writes one audit+notification, rejects replay and cross-org", async () => {
    const db = new PGlite(); opened.push(db);
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
      create table orgs(id uuid primary key); create table users(id uuid primary key);
      create table org_members(org_id uuid,user_id uuid,role text,scope text,primary key(org_id,user_id));
      create table deals(id uuid primary key,org_id uuid,assigned_to uuid);
      create table notifications(id uuid primary key default gen_random_uuid(),org_id uuid,user_id uuid,type text,title text,body text,target_type text,target_id uuid,actor_id uuid,is_action boolean);
      insert into orgs values('${id(1)}'),('${id(2)}');
      insert into users values('${id(10)}'),('${id(11)}'),('${id(12)}');
      insert into org_members values('${id(1)}','${id(10)}','member','assigned'),('${id(1)}','${id(11)}','owner','all'),('${id(1)}','${id(12)}','member','assigned');
      insert into deals values('${id(20)}','${id(1)}','${id(10)}'),('${id(21)}','${id(2)}','${id(10)}');
    `);
    await db.exec(migration);
    await db.exec(`select set_config('app.uid','${id(10)}',false)`);
    const request = id(30);
    expect((await db.query<{ result: string }>(`select request_deal_seal_approval('${id(1)}','${id(20)}','${request}') result`)).rows[0].result).toBe("sent");
    expect((await db.query<{ result: string }>(`select request_deal_seal_approval('${id(1)}','${id(20)}','${request}') result`)).rows[0].result).toBe("already_sent");
    expect((await db.query<{ n: number }>("select count(*)::int n from seal_approval_requests")).rows[0].n).toBe(1);
    expect((await db.query<{ n: number }>("select count(*)::int n from notifications where type='requested'")).rows[0].n).toBe(1);
    await expect(db.query(`select request_deal_seal_approval('${id(2)}','${id(21)}','${id(31)}')`)).rejects.toThrow(/unavailable/);
    await db.exec(`select set_config('app.uid','${id(12)}',false)`);
    await expect(db.query(`select request_deal_seal_approval('${id(1)}','${id(20)}','${id(32)}')`)).rejects.toThrow(/unavailable/);
  });
});
