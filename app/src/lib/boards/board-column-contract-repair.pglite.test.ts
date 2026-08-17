import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const migrationPath = resolve(process.cwd(), "../supabase/migrations/075_board_column_contract_repair.sql");
const opened: PGlite[] = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
}, 15_000);

describe("BBE-163 hosted board-column contract repair", () => {
  it("adds the missing 052/056 contract and is safe to rerun", async () => {
    const db = new PGlite();
    opened.push(db);
    await db.exec(`
      create schema if not exists public;
      create type public.field_type as enum (
        'text','longtext','number','date','datetime','select','multiselect',
        'phone','email','file','person','url','checkbox','status'
      );
      create table public.board_columns (
        id uuid primary key,
        type public.field_type not null
      );
    `);

    const migration = await readFile(migrationPath, "utf8");
    await db.exec(migration);
    await db.exec(migration);

    const columns = await db.query<{ column_name: string }>(`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'board_columns'
    `);
    for (const name of ["source", "right_pinned", "move_rule_jsonb", "is_readonly"]) {
      expect(columns.rows.map((row) => row.column_name)).toContain(name);
    }

    const labels = await db.query<{ enumlabel: string }>(`
      select enumlabel from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'field_type'
    `);
    for (const label of ["people", "money", "calc"]) {
      expect(labels.rows.map((row) => row.enumlabel)).toContain(label);
    }
  }, 15_000);
});
