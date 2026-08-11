import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const localPglite = path.join(root, "node_modules", "@electric-sql", "pglite", "dist", "index.js");
const labPglite = path.join(root, "..", "labs", "multi-workspace-entry", "node_modules", "@electric-sql", "pglite", "dist", "index.js");
const pgliteModule = existsSync(localPglite) ? localPglite : labPglite;
const { PGlite } = await import(
  pathToFileURL(pgliteModule).href,
);
const compatible = (sql) => sql
  .split(/\r?\n/u)
  .filter((line) => !/^\s*create extension\b.*\bpgcrypto\b/iu.test(line))
  .join("\n");

test("onboarding practice RPCs isolate owner org_id and reject foreign progress", async () => {
  const db = new PGlite();
  const ownerA = "48000000-0000-0000-0000-000000000001";
  const ownerB = "48000000-0000-0000-0000-000000000002";
  try {
    await db.exec(`
      create schema auth;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create table auth.users(id uuid primary key,email text,aud text,role text);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      grant usage on schema auth,public to anon,authenticated,service_role;
      grant execute on function auth.uid() to public;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
      alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
    `);
    for (const name of ["0001_init.sql", "001_schema_v1.sql", "048_onboarding.sql"]) {
      await db.exec(compatible(await readFile(path.join(root, "supabase", "migrations", name), "utf8")));
    }
    await db.exec(`
      insert into auth.users values
        ('${ownerA}','a@test.invalid','authenticated','authenticated'),
        ('${ownerB}','b@test.invalid','authenticated','authenticated');
      insert into public.users(id,email,name) values
        ('${ownerA}','a@test.invalid','Owner A'),
        ('${ownerB}','b@test.invalid','Owner B');
    `);
    await db.exec(`select set_config('request.jwt.claim.sub','${ownerA}',false); set role authenticated;`);
    const orgA = (await db.query("select public.ensure_my_practice_workspace() as id")).rows[0].id;
    await db.exec("reset role");
    await db.exec(`select set_config('request.jwt.claim.sub','${ownerB}',false); set role authenticated;`);
    const orgB = (await db.query("select public.ensure_my_practice_workspace() as id")).rows[0].id;
    assert.notEqual(orgA, orgB);
    assert.deepEqual((await db.query("select public.read_my_practice_workspace() as id")).rows, [{ id: orgB }]);
    assert.deepEqual(
      (await db.query(`select public.is_my_practice_workspace('${orgA}'::uuid) as owns`)).rows,
      [{ owns: false }],
    );
    await assert.rejects(
      db.query(`select public.record_quest_progress('${orgA}'::uuid, 'create-first-item')`),
      /not the caller's practice workspace/iu,
    );
  } finally {
    await db.close();
  }
});
