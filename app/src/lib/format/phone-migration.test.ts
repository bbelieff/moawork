import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/040_phone_normalize.sql"),
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

  it("matches same-key field definitions by their resolved entity", () => {
    expect(migration).toContain("public.resolve_field_value_entity(fv.org_id, fv.entity_id)");
    expect(migration).toContain("fd.entity = public.resolve_field_value_entity");
    expect(migration).toContain("fd.entity = v_entity");
    expect(migration).toContain("from public.companies c");
    expect(migration).toContain("from public.deals d");
    expect(migration).toContain("v_entity is null");
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

  it("documents aggregate read-back and exact raw-value rollback", () => {
    expect(migration).toContain("Hosted apply read-back (aggregate-only");
    expect(migration).toContain("company_non_digit_count");
    expect(migration).toContain("update public.field_values fv set value_jsonb = o.raw_value");
    expect(migration).toContain("update public.item_values iv set value_jsonb = o.raw_value");
    expect(migration).toContain("update public.companies set phone = phone_original");
  });
});
