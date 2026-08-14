import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workPage = new URL("../../app/(app)/work/page.tsx", import.meta.url);

describe("BBE-150 /work production repository boundary", () => {
  it("uses one request-scoped Supabase client without a LocalBoardsRepo factory fallback", () => {
    const source = readFileSync(workPage, "utf8");

    expect(source).not.toMatch(/@\/lib\/repo\/local\/boardsRepo/);
    expect(source).not.toMatch(/\bgetBoardsRepo\s*\(/);
    expect(source).toContain("const client = await createClient()");
    expect(source).toContain("new SupabaseBoardsRepo(client)");
    expect(source).toContain("new WorkManagementSource(client)");
    expect(source.match(/await createClient\(\)/g)).toHaveLength(1);
  });
});
