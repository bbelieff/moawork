import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const lab = path.resolve(root, "..", "labs", "multi-workspace-entry");
const { PGlite } = await import(
  pathToFileURL(path.join(lab, "node_modules", "@electric-sql", "pglite", "dist", "index.js")).href,
);
const migrations = [
  "0001_init.sql",
  "001_schema_v1.sql",
  "003_boards_engine.sql",
  "041_messaging.sql",
];
const compatible = (sql) => sql
  .split(/\r?\n/u)
  .filter((line) => !/^\s*create extension\b.*\bpgcrypto\b/iu.test(line))
  .join("\n");

test("messaging rules reject foreign-org templates before a body snapshot can be copied", async () => {
  const db = new PGlite();
  const ownerA = "36000000-0000-0000-0000-000000000001";
  const ownerB = "36000000-0000-0000-0000-000000000002";
  const orgA = "36000000-0000-0000-0000-000000000010";
  const orgB = "36000000-0000-0000-0000-000000000020";
  const boardA = "36000000-0000-0000-0000-000000000030";
  const templateA = "36000000-0000-0000-0000-000000000040";
  const templateB = "36000000-0000-0000-0000-000000000041";
  const itemA = "36000000-0000-0000-0000-000000000050";

  try {
    await db.exec(`
      create schema auth;
      create schema extensions;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create table auth.users(id uuid primary key,email text,aud text,role text);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      create function public.digest(p bytea,a text) returns bytea language sql immutable strict as $$
        select decode(md5(encode(p,'hex')||a)||md5(a||encode(p,'hex')),'hex')
      $$;
      create function public.gen_random_bytes(n integer) returns bytea language sql volatile strict as $$
        select decode(substr(repeat(md5(random()::text),8),1,n*2),'hex')
      $$;
      grant usage on schema auth,public to anon,authenticated,service_role;
      grant execute on function auth.uid() to public;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
      alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
    `);

    for (const name of migrations) {
      await db.exec(compatible(await readFile(path.join(root, "supabase", "migrations", name), "utf8")));
    }

    await db.exec(`
      insert into auth.users values
        ('${ownerA}','owner-a@test.invalid','authenticated','authenticated'),
        ('${ownerB}','owner-b@test.invalid','authenticated','authenticated');
      insert into public.users(id,email,name) values
        ('${ownerA}','owner-a@test.invalid','Owner A'),
        ('${ownerB}','owner-b@test.invalid','Owner B');
      select set_config('request.jwt.claim.sub','${ownerA}',false);
      insert into public.orgs(id,name) values('${orgA}','Synthetic A');
      select set_config('request.jwt.claim.sub','${ownerB}',false);
      insert into public.orgs(id,name) values('${orgB}','Synthetic B');
      insert into public.boards(id,org_id,name) values('${boardA}','${orgA}','Board A');
      insert into public.message_templates(id,org_id,channel,code,name,body,status) values
        ('${templateA}','${orgA}','sms','own','Own template','Own body','approved'),
        ('${templateB}','${orgB}','sms','foreign','Foreign template','Foreign secret body','approved');
      select set_config('request.jwt.claim.sub','${ownerA}',false);
      set role authenticated;
    `);

    await assert.rejects(
      db.exec(`
        insert into public.messaging_trigger_rules(
          org_id,board_id,column_key,trigger_value,phone_column_key,sender_digits,template_id
        ) values (
          '${orgA}','${boardA}','status','ready','phone','0212345678','${templateB}'
        )
      `),
      /foreign key/iu,
    );

    await db.exec("reset role");
    assert.deepEqual(
      (await db.query("select count(*)::integer as n from public.messaging_trigger_rules")).rows,
      [{ n: 0 }],
    );
    assert.deepEqual(
      (await db.query("select count(*)::integer as n from public.messages")).rows,
      [{ n: 0 }],
    );

    await db.exec(`
      select set_config('request.jwt.claim.sub','${ownerA}',false);
      set role authenticated;
      insert into public.messaging_trigger_rules(
        org_id,board_id,column_key,trigger_value,phone_column_key,sender_digits,template_id
      ) values (
        '${orgA}','${boardA}','status','ready','phone','0212345678','${templateA}'
      );
      reset role;
      insert into public.items(id,org_id,board_id,title) values('${itemA}','${orgA}','${boardA}','Synthetic item');
      insert into public.item_values(org_id,item_id,column_key,value_jsonb) values
        ('${orgA}','${itemA}','phone','{"value":"01012345678"}'::jsonb),
        ('${orgA}','${itemA}','status','{"value":"ready"}'::jsonb);
    `);

    assert.deepEqual(
      (await db.query("select org_id,template_id,body_snapshot from public.messages")).rows,
      [{ org_id: orgA, template_id: templateA, body_snapshot: "Own body" }],
    );
    assert.equal(
      JSON.stringify((await db.query("select body_snapshot from public.messages")).rows)
        .includes("Foreign secret body"),
      false,
    );
  } finally {
    await db.close();
  }
});
