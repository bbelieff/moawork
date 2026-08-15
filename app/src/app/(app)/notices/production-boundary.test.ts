import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("BBE-151 notice entry production boundary", () => {
  it("shares one request-scoped Supabase adapter and keeps LocalBoardsRepo out", () => {
    const source = readFileSync(join(process.cwd(), "src/app/(app)/notices/page.tsx"), "utf8");
    expect(source).toContain("const client = await createClient()");
    expect(source).toContain("const repo = new SupabaseBoardsRepo(client)");
    expect(source).toContain("resolveExistingNoticeBoard(ctx, repo)");
    expect(source).toContain("new NoticesService(new BoardsService(repo), repo)");
    expect(source).not.toMatch(/\bgetBoardsRepo\s*\(/);
    expect(source).not.toContain("LocalBoardsRepo");
  });
});
