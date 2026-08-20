import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("BBE-191 hosted schema preserves values across definition delete and same-key recreation", async () => {
  const db = new PGlite();
  await db.exec(`
    create table field_defs (
      id uuid primary key,
      org_id uuid not null,
      entity text not null,
      key text not null,
      unique (org_id, entity, key)
    );
    create table field_values (
      org_id uuid not null,
      entity text not null check (entity in ('company', 'deal')),
      entity_id uuid not null,
      field_key text not null,
      value_jsonb jsonb,
      primary key (entity, entity_id, field_key)
    );
  `);
  const org = "00000000-0000-0000-0000-000000000001";
  const entity = "00000000-0000-0000-0000-000000000002";
  const firstDef = "00000000-0000-0000-0000-000000000003";
  const nextDef = "00000000-0000-0000-0000-000000000004";
  await db.query("insert into field_defs values ($1,$2,'deal','memo')", [firstDef, org]);
  await db.query("insert into field_values values ($1,'deal',$2,'memo',$3)", [org, entity, JSON.stringify("kept")]);

  const before = await db.query("select count(*)::int as count from field_values where org_id=$1", [org]);
  await db.query("delete from field_defs where org_id=$1 and id=$2", [org, firstDef]);
  const after = await db.query("select count(*)::int as count from field_values where org_id=$1", [org]);
  assert.equal(after.rows[0].count, before.rows[0].count);

  await db.query("insert into field_defs values ($1,$2,'deal','memo')", [nextDef, org]);
  const restored = await db.query(`
    select fv.value_jsonb
      from field_values fv
      join field_defs fd on fd.org_id=fv.org_id and fd.key=fv.field_key and fd.entity=fv.entity
     where fv.org_id=$1 and fv.entity='deal' and fv.entity_id=$2
  `, [org, entity]);
  assert.deepEqual(restored.rows, [{ value_jsonb: "kept" }]);

  await db.query("delete from field_defs where org_id=$1 and id=$2", [org, nextDef]);
  await db.query("insert into field_defs values ($1,$2,'company','memo')", [nextDef, org]);
  const wrongEntity = await db.query(`
    select fv.value_jsonb
      from field_values fv
      join field_defs fd on fd.org_id=fv.org_id and fd.key=fv.field_key and fd.entity=fv.entity
     where fv.org_id=$1 and fv.entity='company' and fv.entity_id=$2
  `, [org, entity]);
  assert.deepEqual(wrongEntity.rows, []);
  await db.close();
});
