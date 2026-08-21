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
    ('098_bbe215_today_kpi_definitions','098_bbe215_today_kpi_definitions.sql','574e35fae8acd5bbec27a0ed43dfceb0aa833843c291249c392179503b194a61','097_bbe201_new_lead_field_write_restore','test','test',clock_timestamp()),
    ('099_bbe235_work_board_projection','099.sql','a289e67cad159ccc6937dfb6505d248993451d1b62c2ae12c204408ac5dbd6e8','098_bbe215_today_kpi_definitions','test','test',clock_timestamp()),
    ('100_bbe236_company_csv_import','100.sql','386eb1b07c46900a781e614864f563094193d9afe313c3a1427a267adf0cfd75','099_bbe235_work_board_projection','test','test',clock_timestamp()),
    ('101_bbe238_notice_board_unlock','101.sql','c83e6f3407646109c7b5bf3e387860ab61d40515f698d9fe16fe993eda62fe5a','100_bbe236_company_csv_import','test','test',clock_timestamp()),
    ('102_bbe239_board_item_files_storage','102.sql','555518005c270ce5ea9141fb13e1ded35f641144ac41863448fda32ad3811c38','101_bbe238_notice_board_unlock','test','test',clock_timestamp()),
    ('103_bbe240_deal_ledger_vat_wiring','103.sql','866de2fb1741325d0f95b53c1160b0b05cbf3f90ba2a03f1a13bb2e60fcd4f0b','102_bbe239_board_item_files_storage','test','test',clock_timestamp()),
    ('104_bbe240_deals_fee_terms','104.sql','8b864d7609a18ea78eb59f04f038112c57f5a42ef7cb0f27f637296b84920205','103_bbe240_deal_ledger_vat_wiring','test','test',clock_timestamp()),
    ('105_bbe240_reserve_ledger_workspace_slug','105.sql','3d36f8d3eea65fa91c8354b78de620eb6b3aa73f8e5194c1bc19672aa5a6ca95','104_bbe240_deals_fee_terms','test','test',clock_timestamp()),
    ('106_bbe242_board_column_check_execute_restore','106.sql','8f0c1215c0d87045490c09312fd73caa114c9eca7e90119b77dbc72cb9d06791','105_bbe240_reserve_ledger_workspace_slug','test','test',clock_timestamp()),
    ('107_bbe244_workspace_deletion_request','107_bbe244_workspace_deletion_request.sql','d1ef91a17c0467fb450e3ce68348a1ee1bda0d892fcb7f6cc6cad6131eb25c1c','106_bbe242_board_column_check_execute_restore','test','test',clock_timestamp()),
    ('108_bbe244_list_my_workspaces','108_bbe244_list_my_workspaces.sql','${hostedDigest}','107_bbe244_workspace_deletion_request','test','test',clock_timestamp())`);
  if (includeLogo) {
    await db.exec(`insert into public.migration_apply_guard values
      ('098_bbe199_org_logo','098_bbe199_org_logo.sql','04b21bb5bf897849a4b00d0d8aa2c280a6ae1c69c325610f2e1cf8a35ff034e8','095_bbe172_new_lead_contact_transition','test','test',clock_timestamp())`);
  }
  return db;
}

async function setupRepo() {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec(foundation);
  await db.exec(`insert into public.migration_apply_guard values ('108_bbe199_org_logo','108_bbe199_org_logo.sql','911962c8b94e61192c5dd6faa21f59afce652581de851f0987e5ddc5e8ffd3b8','107_bbe242_board_column_check_execute_restore','test','test',clock_timestamp())`);
  return db;
}

test("joins a fresh repository frontier into the same canonical 109 successor", async () => {
  const db = await setupRepo();
  try {
    await db.exec(bridge);
    const row = (await db.query("select logical_key, expected_predecessor from public.migration_apply_guard where logical_key='109_bbe268_migration_frontier_bridge'")).rows[0];
    assert.deepEqual(row, { logical_key: "109_bbe268_migration_frontier_bridge", expected_predecessor: "108_bbe244_list_my_workspaces" });
    await db.exec(`select public.begin_guarded_migration('110_next','110_next.sql','${"2".repeat(64)}','109_bbe268_migration_frontier_bridge','test','test',false)`);
  } finally { await db.close(); }
});

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
      await assert.rejects(db.exec(bridge), /exactly one recognized migration frontier is required/u);
      assert.equal((await db.query("select count(*)::int as count from public.migration_apply_guard where logical_key='109_bbe268_migration_frontier_bridge'")).rows[0].count, 0);
    } finally { await db.close(); }
  }

  const db = await setup();
  try {
    await db.exec(`insert into public.migration_apply_guard values ('110_unexpected','110_unexpected.sql','${"3".repeat(64)}','108_bbe244_list_my_workspaces','test','test',clock_timestamp())`);
    await assert.rejects(db.exec(bridge), /migration frontier advanced before bridge/u);
    assert.equal((await db.query("select count(*)::int as count from public.migration_apply_guard where logical_key='109_bbe268_migration_frontier_bridge'")).rows[0].count, 0);
  } finally { await db.close(); }
});

test("failed bridge rolls back its guard and succeeds on retry after exact repair", async () => {
  const db = await setup({ includeLogo: false });
  try {
    await assert.rejects(db.exec(bridge), /exactly one recognized migration frontier is required/u);
    await db.exec(`insert into public.migration_apply_guard values
      ('098_bbe199_org_logo','098_bbe199_org_logo.sql','04b21bb5bf897849a4b00d0d8aa2c280a6ae1c69c325610f2e1cf8a35ff034e8','095_bbe172_new_lead_contact_transition','test','test',clock_timestamp())`);
    await db.exec(bridge);
    assert.equal((await db.query("select count(*)::int as count from public.migration_apply_guard where logical_key='109_bbe268_migration_frontier_bridge'")).rows[0].count, 1);
  } finally { await db.close(); }
});
