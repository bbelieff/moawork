import { describe, expect, it } from "vitest";

import { BoardsService } from "./service";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import type { Ctx } from "@/lib/types";

const owner = {
  org: { id: "org-1" },
  user: { id: "user-1" },
  role: "owner",
  scope: "all",
} as unknown as Ctx;

/**
 * 153-draft 별도 보관의 서비스 분리 — 같은 읽기에서 메모리로 나눈다.
 * 휴지통 쿼리·값 수화는 그대로 1회씩이므로 BBE-214 왕복 예산이 늘지 않는다
 * (page.roundtrips 계약은 그 파일에서 검증한다).
 */
describe("스냅샷 보관 분리 (추가 왕복 없음)", () => {
  it("보관 행은 items에서 빠지고 archivedItems에만 든다", async () => {
    const local = new LocalBoardsRepo();
    const service = new BoardsService(toAsyncBoardsRepo(local));
    const detail = await service.createBoard(owner, { name: "보관 분리" });
    const active = await service.createItem(owner, detail.board.id, { title: "활성" });
    const shelved = await service.createItem(owner, detail.board.id, { title: "보관" });
    // 보관 마커는 153 RPC가 쓰지만, 분리 로직 검증용으로 로컬 행에 직접 찍는다.
    local.updateItem(owner, shelved.id, { archived_at: "2026-09-26T00:00:00.000Z" } as never);

    const snapshot = await service.loadPageSnapshot(owner, detail.board.id, { includeDeleted: true });

    expect(snapshot.items.map((item) => item.id)).toEqual([active.id]);
    expect(snapshot.archivedItems.map((item) => item.id)).toEqual([shelved.id]);
    expect(snapshot.deletedItems).toEqual([]);
    // 활성·보관·휴지통 범위는 겹치지 않는다.
    const ids = [...snapshot.items, ...snapshot.archivedItems, ...snapshot.deletedItems].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includeDeleted 없이는 보관 목록을 발행하지 않는다", async () => {
    const local = new LocalBoardsRepo();
    const service = new BoardsService(toAsyncBoardsRepo(local));
    const detail = await service.createBoard(owner, { name: "보관 가시성" });
    const shelved = await service.createItem(owner, detail.board.id, { title: "보관" });
    local.updateItem(owner, shelved.id, { archived_at: "2026-09-26T00:00:00.000Z" } as never);

    const snapshot = await service.loadPageSnapshot(owner, detail.board.id);

    expect(snapshot.items).toEqual([]);
    expect(snapshot.archivedItems).toEqual([]);
  });

  it("service.listItems는 보관 행을 제외한다 (대시·권한 집계 계약 유지)", async () => {
    const local = new LocalBoardsRepo();
    const service = new BoardsService(toAsyncBoardsRepo(local));
    const detail = await service.createBoard(owner, { name: "목록 제외" });
    await service.createItem(owner, detail.board.id, { title: "활성" });
    const shelved = await service.createItem(owner, detail.board.id, { title: "보관" });
    local.updateItem(owner, shelved.id, { archived_at: "2026-09-26T00:00:00.000Z" } as never);

    expect((await service.listItems(owner, detail.board.id)).map((item) => item.title)).toEqual(["활성"]);
  });
});
