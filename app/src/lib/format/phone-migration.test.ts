import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/036_phone_normalize.sql"),
  "utf8",
);

describe("phone normalization migration contract", () => {
  it("preserves legacy raw company and EAV values before normalization", () => {
    expect(migration).toContain("add column if not exists phone_original text");
    expect(migration).toContain("create table if not exists public.phone_normalization_originals");
    expect(migration).toContain("insert into public.phone_normalization_originals");
    expect(migration).toContain("on conflict do nothing");
    expect(migration).toContain("normalization_status");
  });

  it("covers typed company, custom-field, and board-item storage paths", () => {
    expect(migration).toContain("trg_companies_normalize_phone");
    expect(migration).toContain("trg_field_values_normalize_phone");
    expect(migration).toContain("trg_item_values_normalize_phone");
    expect(migration).toContain("companies_phone_digits_only");
  });

  it("locks the raw-value audit table away from user roles", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain(
      "revoke all on table public.phone_normalization_originals from anon, authenticated",
    );
  });

  it("marks unreadable values for review and reports only their count", () => {
    expect(migration).toContain("needs_review");
    expect(migration).toContain("phone_normalization_review_counts");
    expect(migration).toContain("phone normalization needs_review count: %");
  });
});
