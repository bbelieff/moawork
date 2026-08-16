import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("BBE-113 production board boundary", () => {
  it("uses the request-scoped Supabase client for quest judging", () => {
    const source = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
    expect(source).toContain("new SupabaseBoardsRepo(client)");
    expect(source).not.toContain("getBoardsRepo");
    expect(source).not.toContain("LocalBoardsRepo");
  });
});
