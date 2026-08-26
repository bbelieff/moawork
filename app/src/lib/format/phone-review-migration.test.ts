import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../../../supabase/migrations/131_issue528_item_phone_review_status.sql", import.meta.url), "utf8");

describe("issue 528 전화 검토상태 화면 연결 migration", () => {
  it("원문은 노출하지 않고 item_values에 검토상태를 보존한다", () => {
    expect(sql).toContain("phone_normalization_status");
    expect(sql).toMatch(/original\.normalization_status = 'needs_review'/);
    expect(sql).toMatch(/new\.phone_normalization_status := case when v_normalized is null then 'needs_review' else 'normalized' end/);
    expect(sql).toMatch(/revoke all on function public\.normalize_item_value_phone\(\) from public, anon, authenticated, service_role/);
  });
});
