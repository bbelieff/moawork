import { beforeEach, describe, expect, it } from "vitest";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import type { Ctx } from "@/lib/types";
import { NOTICE_TAB_SOURCE } from "@/lib/default-tabs/types";
import { markNoticeBoardRead, NOTICE_READER_VALUE_KEY } from "./read-tracking";

const ctx = (org: string, user: string): Ctx => ({
  org: { id: org, name: org, plan_tier: "test", created_at: "2026-01-01T00:00:00Z" },
  user: { id: user, email: null, name: user, avatar_url: null, created_at: "2026-01-01T00:00:00Z" },
  role: "owner", scope: "all", isPlatformAdmin: false,
});

describe("notice reader tracking", () => {
  beforeEach(() => resetDb());

  it("records only a targeted reader, deduplicates refresh, and isolates organizations", async () => {
    const repo = new LocalBoardsRepo();
    const asyncRepo = toAsyncBoardsRepo(repo);
    const a = ctx("org-a", "reader-a");
    const b = ctx("org-b", "reader-a");
    const board = repo.createBoard(a, { name: "공지", source: NOTICE_TAB_SOURCE });
    const item = repo.createItem(a, board.id, { title: "공지", values: { audience: [a.user.id, "reader-b"] } });
    await markNoticeBoardRead(a, board, asyncRepo);
    await markNoticeBoardRead(a, board, asyncRepo);
    const values = repo.listValues(a, [item.id]);
    expect(values.find((value) => value.column_key === NOTICE_READER_VALUE_KEY)?.value_jsonb).toEqual([a.user.id]);
    expect(values.find((value) => value.column_key === "read_count")?.value_jsonb).toBe(1);
    await markNoticeBoardRead(b, board, asyncRepo);
    expect(repo.listValues(a, [item.id]).find((value) => value.column_key === "read_count")?.value_jsonb).toBe(1);
  });
});
