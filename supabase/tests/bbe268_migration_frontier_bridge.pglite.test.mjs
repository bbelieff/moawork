import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const foundation = await readFile(new URL("../migrations/094_migration_apply_guard.sql", import.meta.url), "utf8");
const bridge = await readFile(new URL("../migrations/109_bbe268_migration_frontier_bridge.sql", import.meta.url), "utf8");

async function setup({ hostedDigest = "04e0b7f28387941c213a2c2758c8f751fde329cc17ce6c90213900daec00a4bc", includeLogo = true } = {}) {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec(foundation);
  await db.exec(`insert into public.migration_apply_guard values
    ('107_bbe244_workspace_deletion_request','107_bbe244_workspace_deletion_request.sql','${"1".repeat(64)}','106_bbe242_board_column_check_execute_restore','test','test',clock_timestamp()),
    ('108_bbe244_list_my_workspaces','108_bbe244_list_my_workspaces.sql','${hostedDigest}','107_bbe244_workspace_deletion_request','test','test',clock_timestamp())`);
  if (includeLogo) {
    await db.exec(`insert into public.migration_apply_guard values
      ('098_bbe199_org_logo','098_bbe199_org_logo.sql','04b21bb5bf897849a4b00d0d8aa2c280a6ae1c69c325610f2e1cf8a35ff034e8','095_bbe172_new_lead_contact_transition','test','test',clock_timestamp())`);
  }
  return db;
}

test("joins the two 108 frontiers once and makes 109 the ordinary successor", async () => {
  const db = await setup();
  try {
    await db.exec(bridge);
    const row = (await db.query("select logical_key, expected_predecessor from public.migration_apply_guard where logical_key='109_bbe268_migration_frontier_bridge'")).rows[0];
    assert.deepEqual(row, { logical_key: "109_bbe268_migration_frontier_bridge", expected_predecessor: "108_bbe244_list_my_workspaces" });
    await assert.rejects(db.exec(bridge), /migration logical key already applied/u);
    await db.exec(`select public.begin_guarded_migration('110_next','110_next.sql','${"2".repeat(64)}','109_bbe268_migration_frontier_bridge','test','test',false)`);
  } finally { await db.close(); }
});

test("fails closed on digest drift, missing repository equivalent, reverse order, and advanced frontier", async () => {
  for (const options of [{ hostedDigest: "f".repeat(64) }, { includeLogo: false }]) {
    const db = await setup(options);
    try {
      await assert.rejects(db.exec(bridge), /identity mismatch|equivalent is missing/u);
      assert.equal((await db.query("select count(*)::int as count from public.migration_apply_guard where logical_key='109_bbe268_migration_frontier_bridge'")).rows[0].count, 0);
    } finally { await db.close(); }
  }

  const db = await setup();
  try {
    await db.exec(`insert into public.migration_apply_guard values ('110_unexpected','110_unexpected.sql','${"3".repeat(64)}','108_bbe244_list_my_workspaces','test','test',clock_timestamp())`);
    await assert.rejects(db.exec(bridge), /hosted frontier advanced before bridge/u);
    assert.equal((await db.query("select count(*)::int as count from public.migration_apply_guard where logical_key='109_bbe268_migration_frontier_bridge'")).rows[0].count, 0);
  } finally { await db.close(); }
});

test("failed bridge rolls back its guard and succeeds on retry after exact repair", async () => {
  const db = await setup({ includeLogo: false });
  try {
    await assert.rejects(db.exec(bridge), /repository frontier equivalent is missing/u);
    await db.exec(`insert into public.migration_apply_guard values
      ('098_bbe199_org_logo','098_bbe199_org_logo.sql','04b21bb5bf897849a4b00d0d8aa2c280a6ae1c69c325610f2e1cf8a35ff034e8','095_bbe172_new_lead_contact_transition','test','test',clock_timestamp())`);
    await db.exec(bridge);
    assert.equal((await db.query("select count(*)::int as count from public.migration_apply_guard where logical_key='109_bbe268_migration_frontier_bridge'")).rows[0].count, 1);
  } finally { await db.close(); }
});
