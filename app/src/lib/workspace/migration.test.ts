import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../../../supabase/migrations/006_workspace_bootstrap.sql",
    import.meta.url,
  ),
  "utf8",
).toLowerCase();

describe("006 workspace bootstrap migration contract", () => {
  it("authenticated owner만 SECURITY DEFINER RPC를 실행할 수 있다", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("auth.uid() is null");
    expect(sql).toContain("public.org_role(p_org_id)");
    expect(sql).toContain("'owner'::public.member_role");
    expect(sql).toContain("revoke all on function public.bootstrap_workspace(uuid) from public");
    expect(sql).toContain("revoke all on function public.bootstrap_workspace(uuid) from anon");
    expect(sql).toContain("grant execute on function public.bootstrap_workspace(uuid) to authenticated");
  });

  it("동시·반복 호출을 직렬화하고 entitlement source 규칙을 지킨다", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(
      sql.match(/on conflict \(org_id, feature_key\) do update/g),
    ).toHaveLength(2);
    expect(
      sql.match(
        /where current_entitlement\.source = 'plan'::public\.entitlement_source/g,
      ),
    ).toHaveLength(2);
    expect(sql.match(/enabled = excluded\.enabled/g)).toHaveLength(2);
    expect(sql.match(/limit_value = excluded\.limit_value/g)).toHaveLength(2);
    expect(sql.match(/expires_at = null/g)).toHaveLength(2);
    expect(sql).toContain("where not exists");
    expect(sql).toContain("existing.kind = defaults.kind");
  });

  it("기본 stage kind 여섯 개를 선언한다", () => {
    for (const kind of [
      "marketing",
      "meeting",
      "contract",
      "work",
      "settle",
      "post",
    ]) {
      expect(sql).toContain(`'${kind}'::public.stage_kind`);
    }
  });
});
