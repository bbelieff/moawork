import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dependencyRoot = process.env.PGLITE_MODULE_ROOT ?? root;
const { PGlite } = await import(pathToFileURL(path.join(
  dependencyRoot,
  "node_modules",
  "@electric-sql",
  "pglite",
  "dist",
  "index.js",
)).href);
const migrationPath = path.join(root, "supabase", "migrations", "063_policyfund_pack_key_alias.sql");

test("BBE-132 keeps the old pack key as an idempotent alias with exact content parity", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table public.structure_packs (
        key text primary key,
        name text not null,
        pack_jsonb jsonb not null default '{}'
      );
    `);
    const legacy = {
      key: "pack.seoul.policyfund1",
      name: "모아프리셋-정책자금1",
      source: "monday 서울경영지원센터 실측 2026-08-05",
      optionSets: { region: [{ id: "서울_강남구", label: "서울_강남구", order: 0 }] },
      boards: [{ slug: "newcust", columns: [{ key: "date", type: "date" }], sections: [] }],
    };
    await db.query(
      "insert into public.structure_packs(key, name, pack_jsonb) values ($1, $2, $3::jsonb)",
      [legacy.key, legacy.name, JSON.stringify(legacy)],
    );

    const migration = await readFile(migrationPath, "utf8");
    await db.exec(migration);
    await db.exec(migration);

    const result = await db.query(
      "select key, name, pack_jsonb from public.structure_packs order by key",
    );
    assert.equal(result.rows.length, 2);
    const canonical = result.rows.find((row) => row.key === "pack.policyfund.v1");
    const alias = result.rows.find((row) => row.key === "pack.seoul.policyfund1");
    assert.ok(canonical);
    assert.ok(alias);
    assert.deepEqual(alias.pack_jsonb, legacy);
    assert.equal(canonical.name, legacy.name);
    assert.equal(canonical.pack_jsonb.key, "pack.policyfund.v1");
    assert.equal(
      canonical.pack_jsonb.source,
      `실측 출처(특정 고객 전용 팩이 아님): ${legacy.source}`,
    );
    const { key: _canonicalKey, source: _canonicalSource, ...canonicalPayload } = canonical.pack_jsonb;
    const { key: _legacyKey, source: _legacySource, ...legacyPayload } = legacy;
    assert.deepEqual(canonicalPayload, legacyPayload);
  } finally {
    await db.close();
  }
});
