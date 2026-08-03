import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "..",
    "supabase",
    "migrations",
    "030_workspace_entry_create_deadline_repair.sql",
  ),
  "utf8",
);

describe("workspace create deadline repair migration", () => {
  it("backfills only pending create requests with a missing deadline", () => {
    expect(sql).toMatch(
      /update public\.workspace_entry_requests[\s\S]*set review_expires_at = created_at \+ interval '14 days'[\s\S]*where kind = 'create'[\s\S]*and status = 'pending'[\s\S]*and review_expires_at is null;/,
    );
    expect(sql).toContain("workspace_entry_pending_create_deadline_check");
    expect(sql).toMatch(
      /kind <> 'create'[\s\S]*or status <> 'pending'[\s\S]*or review_expires_at is not null/,
    );
  });

  it("restores the 14-day lifecycle for new create requests", () => {
    expect(sql).toMatch(
      /payload_digest, created_at, review_expires_at[\s\S]*v_payload_digest, v_created_at, v_created_at \+ interval '14 days'/,
    );
    expect(sql).toContain("decision_code = 'review_window_expired'");
    expect(sql).toContain("'create_request_expired', 'rejected'");
    expect(sql).toContain("review_expires_at > v_created_at");
  });

  it("preserves the platform-admin atomic create path and replay guard", () => {
    expect(sql).toContain("v_is_platform_admin := public.is_platform_admin()");
    expect(sql).toContain("if v_existing.status = 'approved' then");
    expect(sql).toContain("insert into public.orgs");
    expect(sql).toContain("insert into public.org_members");
    expect(sql).toContain("decision_code = 'platform_admin_direct_create'");
    expect(sql).toContain("'auto_approved', true");
  });

  it("serializes direct creation with the existing admin resolver", () => {
    expect(sql).toMatch(
      /where id = v_existing\.id\s+for update;[\s\S]*v_is_platform_admin := public\.is_platform_admin\(\)/,
    );
    expect(sql).toMatch(
      /update public\.workspace_entry_requests[\s\S]*where id = v_existing\.id\s+and status = 'pending';[\s\S]*get diagnostics v_updated = row_count;/,
    );
    expect(sql).toMatch(
      /if v_updated <> 1 then[\s\S]*request already resolved with a different outcome/,
    );
  });

  it("keeps helper and function privilege boundaries intact", () => {
    expect(sql).not.toMatch(/create or replace function public\.is_org_member/i);
    expect(sql).not.toMatch(/from\s+public\.app_admins/i);
    expect(sql).toMatch(
      /revoke all on function public\.submit_workspace_create_request\(uuid, text, text\)[\s\S]*from public, anon;/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.submit_workspace_create_request\(uuid, text, text\)[\s\S]*to authenticated;/,
    );
  });
});
