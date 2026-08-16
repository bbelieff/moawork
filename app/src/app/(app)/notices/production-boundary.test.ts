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
    expect(source).toContain('data-testid="notice-load-error"');
    expect(source).toContain("unstable_rethrow(error)");
  });
  it("keeps the redirected board screen and writes on the same request-scoped graph", () => {
    const boardPage = readFileSync(join(process.cwd(), "src/app/(app)/boards/[id]/page.tsx"), "utf8");
    const actions = readFileSync(join(process.cwd(), "src/app/(app)/boards/actions.ts"), "utf8");
    expect(boardPage).toContain("createRequestBoards");
    expect(boardPage).toContain("loadedItems.filter((item) => visibleItemIds.has(item.id)).map((item) => item.id)");
    expect(boardPage).toContain("markNoticeItemsReadAtomic(ctx, visibleNoticeIds, client)");
    expect(boardPage).not.toContain("markNoticeItemsReadAtomic(ctx, loadedItems.map");
    expect(actions).toContain("createRequestBoards");
    expect(boardPage).not.toContain("getBoardsService");
    expect(actions).not.toContain("getBoardsService");
  });
});
