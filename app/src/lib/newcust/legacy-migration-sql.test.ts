import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../supabase/migrations/026_newcust_legacy_cutover.sql"), "utf8");

describe("026 newcust cutover security contract", () => {
  it("uses SHA-256 ordered aggregates and actual schema fingerprints", () => {
    expect(sql).toContain("digest(coalesce(jsonb_agg(row_hash order by legacy_id)");
    expect(sql).toContain("newcust_legacy_source_schema_fingerprint");
    expect(sql).toContain("newcust_legacy_target_schema_fingerprint");
    expect(sql).not.toContain("md5(row_data");
  });
  it("protects tenant parents and operation-specific ACL", () => {
    expect(sql).toContain("items_parent_org_fk");
    expect(sql).toContain("board_views_board_org_fk");
    for (const operation of ["select", "insert", "update", "delete"]) expect(sql).toContain(`create policy itemvals_${operation}`);
    for (const table of ["boards", "bgroups", "bcols"]) for (const operation of ["select", "insert", "update", "delete"]) expect(sql).toContain(`create policy ${table}_${operation}`);
    for (const operation of ["select", "insert", "update", "delete"]) expect(sql).toContain(`create policy bviews_${operation}`);
    expect(sql).toContain("user_id=auth.uid() or shared");
    expect(sql).toContain("public.org_role(org_id) in ('owner','admin')");
    expect(sql.match(/source is null or source not in/g)?.length).toBe(4);
  });
  it("rolls back only materialized imported ids and preserves the fence", () => {
    expect(sql).toContain("delete from public.items where id=any(imported_ids)");
    expect(sql).not.toContain("delete from public.items where board_id=c.board_id");
    expect(sql).toContain("status='rolled_back'");
  });
  it("shares the advisory lock with marketing-only write fences", () => {
    expect(sql.match(/pg_advisory_xact_lock/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql).toContain("s.kind='marketing'");
  });
  it("isolates malformed file casts and closes membership phantoms", () => {
    expect(sql).toContain("case when jsonb_typeof(f->'size_bytes')='number' then");
    expect(sql).toContain("lock table public.org_members in share mode");
    expect(sql).not.toContain("foreign key(item_id,org_id) references items");
  });
  it("allows nullable companies and rejects a zero-source canonical apply", () => {
    expect(sql).not.toContain("when c.id is null then 'missing_company'");
    expect(sql).toContain("NEWCUST_NO_SOURCE");
  });
});
