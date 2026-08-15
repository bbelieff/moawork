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
      create table orgs(id uuid primary key,status text not null); create table users(id uuid primary key);
      create table org_members(org_id uuid,user_id uuid,role text,scope text,status text not null,primary key(org_id,user_id));
      create table deals(id uuid primary key,org_id uuid,assigned_to uuid);
      create table notifications(id uuid primary key default gen_random_uuid(),org_id uuid,user_id uuid,type text,title text,body text,target_type text,target_id uuid,actor_id uuid,is_action boolean);
      insert into orgs values('${id(1)}','active'),('${id(2)}','active');
      insert into users values('${id(10)}'),('${id(11)}'),('${id(12)}'),('${id(13)}');
      insert into org_members values
        ('${id(1)}','${id(10)}','member','assigned','active'),
        ('${id(1)}','${id(11)}','owner','all','active'),
        ('${id(1)}','${id(12)}','member','assigned','active'),
        ('${id(1)}','${id(13)}','admin','all','suspended');
      insert into deals values('${id(20)}','${id(1)}','${id(10)}'),('${id(21)}','${id(2)}','${id(10)}');
    `);
    await db.exec(migration);
    await db.exec(`select set_config('app.uid','${id(10)}',false)`);
    const request = id(30);
    expect((await db.query<{ result: string }>(`select request_deal_seal_approval('${id(1)}','${id(20)}','${request}') result`)).rows[0].result).toBe("sent");
    expect((await db.query<{ result: string }>(`select request_deal_seal_approval('${id(1)}','${id(20)}','${request}') result`)).rows[0].result).toBe("already_sent");
    expect((await db.query<{ n: number }>("select count(*)::int n from seal_approval_requests")).rows[0].n).toBe(1);
    expect((await db.query<{ n: number }>("select count(*)::int n from notifications where type='requested'")).rows[0].n).toBe(1);
    expect((await db.query<{ approver_id: string }>("select approver_id from seal_approval_requests")).rows[0].approver_id).toBe(id(11));
    await expect(db.query(`select request_deal_seal_approval('${id(2)}','${id(21)}','${id(31)}')`)).rejects.toThrow(/unavailable/);
    await db.exec(`select set_config('app.uid','${id(12)}',false)`);
    await expect(db.query(`select request_deal_seal_approval('${id(1)}','${id(20)}','${id(32)}')`)).rejects.toThrow(/unavailable/);

    for (const status of ["suspended", "removed", "expired"]) {
      await db.exec(`update org_members set status='${status}' where org_id='${id(1)}' and user_id='${id(10)}'; select set_config('app.uid','${id(10)}',false)`);
      await expect(db.query(`select request_deal_seal_approval('${id(1)}','${id(20)}',gen_random_uuid())`)).rejects.toThrow(/unavailable/);
    }
    await db.exec(`update org_members set status='active' where org_id='${id(1)}' and user_id='${id(10)}'; update org_members set status='suspended' where org_id='${id(1)}' and user_id='${id(11)}'`);
    expect((await db.query<{ result: string }>(`select request_deal_seal_approval('${id(1)}','${id(20)}','${id(33)}') result`)).rows[0].result).toBe("no_approver");
    expect((await db.query<{ n: number }>("select count(*)::int n from seal_approval_requests")).rows[0].n).toBe(1);
    expect((await db.query<{ n: number }>("select count(*)::int n from notifications")).rows[0].n).toBe(1);
    await db.exec(`update org_members set status='active' where org_id='${id(1)}' and user_id='${id(11)}'; update orgs set status='suspended' where id='${id(1)}'`);
    await expect(db.query(`select request_deal_seal_approval('${id(1)}','${id(20)}',gen_random_uuid())`)).rejects.toThrow(/unavailable/);
  });
});
