import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/lib/repo/supabase/boardsRepo.ts"), "utf8");

describe("SupabaseBoardsRepo BBE-107 request-scoped 저장 경계", () => {
  it("주입 client와 org 조건으로 board/group layout만 갱신한다", () => {
    expect(source).toContain('update({ detail_layout_jsonb: normalizeDetailLayout(layout)');
    expect(source).toContain('update({ detail_layout_jsonb: layout === null ? null : normalizeDetailLayout(layout) })');
    expect(source.match(/\.eq\("org_id", ctx\.org\.id\)\.eq\("id", id\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).not.toContain("service_role");
  });
});
