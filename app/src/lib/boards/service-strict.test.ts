import { describe, it, expect, beforeEach, vi } from "vitest";
import { BoardsService, NotFoundError } from "./service";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import {
  SEED_ORG_ID,
  SEED_USER_OWNER,
} from "@/lib/repo/local/seed";
import { getRepo } from "@/lib/repo";
import type { Ctx } from "@/lib/types";
import type { BoardsRepo } from "./store";

function ctxFor(): Ctx {
  const repo = getRepo();
  const user = repo.getUser(SEED_USER_OWNER);
  const org = repo.getOrg(SEED_ORG_ID);
  if (!user || !org) throw new Error("seed 누락");
  return { user, org, role: "owner", scope: "all" };
}

let svc: BoardsService;
let owner: Ctx;

beforeEach(() => {
  resetDb();
  svc = new BoardsService(toAsyncBoardsRepo(new LocalBoardsRepo()));
  owner = ctxFor();
});

async function makePairBoard() {
  const detail = await svc.createBoard(owner, { name: "지역 쌍" });
  const sido = await svc.addColumn(owner, detail.board.id, { label: "시도", type: "text" });
  const sigungu = await svc.addColumn(owner, detail.board.id, { label: "시군구", type: "text" });
  const item = await svc.createItem(owner, detail.board.id, { title: "행1" });
  await svc.setCells(owner, detail.board.id, item.id, {
    [sido.key]: "서울",
    [sigungu.key]: "강남구",
  });
  return { boardId: detail.board.id, sidoKey: sido.key, sigunguKey: sigungu.key, itemId: item.id };
}

describe("setCellsStrict 쌍원자 저장", () => {
  it("두 키가 모두 유효하면 한 번에 저장한다", async () => {
    const { boardId, sidoKey, sigunguKey, itemId } = await makePairBoard();
    const result = await svc.setCellsStrict(
      owner,
      boardId,
      itemId,
      { [sidoKey]: "부산", [sigunguKey]: "해운대구" },
      crypto.randomUUID(),
      [sidoKey, sigunguKey],
    );
    expect(result.errors).toEqual([]);
    expect(result.committed).toBe("all");
    const reread = await svc.getItem(owner, boardId, itemId);
    expect(reread.values[sidoKey]).toBe("부산");
    expect(reread.values[sigunguKey]).toBe("해운대구");
  });

  it("단일 upsert 1회로 두 값을 함께 쓴다", async () => {
    const local = new LocalBoardsRepo();
    const strict = new BoardsService(toAsyncBoardsRepo(local));
    const detail = await strict.createBoard(owner, { name: "단일쓰기" });
    const sido = await strict.addColumn(owner, detail.board.id, { label: "시도", type: "text" });
    const sigungu = await strict.addColumn(owner, detail.board.id, { label: "시군구", type: "text" });
    const item = await strict.createItem(owner, detail.board.id, { title: "행1" });
    const spy = vi.spyOn(local, "setValues");
    const result = await strict.setCellsStrict(
      owner,
      detail.board.id,
      item.id,
      { [sido.key]: "서울", [sigungu.key]: "강남구" },
      crypto.randomUUID(),
      [sido.key, sigungu.key],
    );
    expect(result.errors).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.anything(), item.id, { [sido.key]: "서울", [sigungu.key]: "강남구" });
  });

  it("readonly 실패에도 이전 두 값을 유지한다", async () => {
    const { boardId, sidoKey, sigunguKey, itemId } = await makePairBoard();
    const columns = (await svc.getBoardDetail(owner, boardId)).columns;
    const sigunguCol = columns.find((c) => c.key === sigunguKey)!;
    await svc.updateColumn(owner, boardId, sigunguCol.id, { readOnly: true });
    const result = await svc.setCellsStrict(
      owner,
      boardId,
      itemId,
      { [sidoKey]: "부산", [sigunguKey]: "해운대구" },
      crypto.randomUUID(),
      [sidoKey, sigunguKey],
    );
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.committed).toBe("none");
    const reread = await svc.getItem(owner, boardId, itemId);
    expect(reread.values[sidoKey]).toBe("서울");
    expect(reread.values[sigunguKey]).toBe("강남구");
  });

  it("삭제된 행은 throw하고 값을 건드리지 않는다", async () => {
    const { boardId, sidoKey, sigunguKey, itemId } = await makePairBoard();
    await svc.deleteItem(owner, boardId, itemId);
    await expect(
      svc.setCellsStrict(
        owner,
        boardId,
        itemId,
        { [sidoKey]: "부산", [sigunguKey]: "해운대구" },
        crypto.randomUUID(),
        [sidoKey, sigunguKey],
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    const restored = await svc.restoreItem(owner, boardId, itemId);
    expect(restored.values[sidoKey]).toBe("서울");
    expect(restored.values[sigunguKey]).toBe("강남구");
  });

  it("선택지 불일치에도 이전 두 값을 유지한다", async () => {
    const detail = await svc.createBoard(owner, { name: "선택지 쌍" });
    const sido = await svc.addColumn(owner, detail.board.id, {
      label: "시도",
      type: "select",
      options: [
        { id: "seoul", label: "서울" },
        { id: "busan", label: "부산" },
      ],
    });
    const sigungu = await svc.addColumn(owner, detail.board.id, { label: "시군구", type: "text" });
    const item = await svc.createItem(owner, detail.board.id, { title: "행1" });
    await svc.setCells(owner, detail.board.id, item.id, { [sido.key]: "seoul", [sigungu.key]: "강남구" });
    const result = await svc.setCellsStrict(
      owner,
      detail.board.id,
      item.id,
      { [sido.key]: "ghost", [sigungu.key]: "해운대구" },
      crypto.randomUUID(),
      [sido.key, sigungu.key],
    );
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.committed).toBe("none");
    const reread = await svc.getItem(owner, detail.board.id, item.id);
    expect(reread.values[sido.key]).toBe("seoul");
    expect(reread.values[sigungu.key]).toBe("강남구");
  });

  it("source 비편집(수식) 칸이 끼면 둘 다 쓰지 않는다", async () => {
    const { boardId, sidoKey, sigunguKey, itemId } = await makePairBoard();
    const columns = (await svc.getBoardDetail(owner, boardId)).columns;
    const sigunguCol = columns.find((c) => c.key === sigunguKey)!;
    await svc.updateColumn(owner, boardId, sigunguCol.id, { source: "calc" });
    const result = await svc.setCellsStrict(
      owner,
      boardId,
      itemId,
      { [sidoKey]: "부산", [sigunguKey]: "해운대구" },
      crypto.randomUUID(),
      [sidoKey, sigunguKey],
    );
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.committed).toBe("none");
    const reread = await svc.getItem(owner, boardId, itemId);
    expect(reread.values[sidoKey]).toBe("서울");
    expect(reread.values[sigunguKey]).toBe("강남구");
  });

  it("요청 키 누락·미존재 키도 첫 쓰기 전에 막는다", async () => {
    const { boardId, sidoKey, sigunguKey, itemId } = await makePairBoard();
    const missing = await svc.setCellsStrict(
      owner,
      boardId,
      itemId,
      { [sidoKey]: "부산" },
      crypto.randomUUID(),
      [sidoKey, sigunguKey],
    );
    expect(missing.errors.length).toBeGreaterThan(0);
    expect(missing.committed).toBe("none");
    const unknown = await svc.setCellsStrict(
      owner,
      boardId,
      itemId,
      { [sidoKey]: "부산", no_such_col: "x" },
      crypto.randomUUID(),
      [sidoKey, sigunguKey],
    );
    expect(unknown.errors.length).toBeGreaterThan(0);
    expect(unknown.committed).toBe("none");
    const reread = await svc.getItem(owner, boardId, itemId);
    expect(reread.values[sidoKey]).toBe("서울");
    expect(reread.values[sigunguKey]).toBe("강남구");
  });

  it("값은 반영됐는데 후처리가 실패하면 미저장으로 꾸미지 않고 범위를 분명히 한다", async () => {
    const { boardId, sidoKey, sigunguKey, itemId } = await makePairBoard();
    // svc 의 repo.setValues 를 감싸 값은 남기고 throw한다 —
    // Supabase upsert 성공 뒤 items.updated_at touch 실패와 같은 상태.
    const inner = svc as unknown as { repo: Promise<BoardsRepo> };
    const realRepo = await inner.repo;
    const realSetValues = realRepo.setValues.bind(realRepo);
    realRepo.setValues = (async (ctx: Ctx, targetItemId: string, patch: Record<string, never>) => {
      await realSetValues(ctx, targetItemId, patch);
      throw new Error("items updated_at touch failed");
    }) as typeof realRepo.setValues;
    try {
      const result = await svc.setCellsStrict(
        owner,
        boardId,
        itemId,
        { [sidoKey]: "부산", [sigunguKey]: "해운대구" },
        crypto.randomUUID(),
        [sidoKey, sigunguKey],
      );
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.committed).toBe("all");
      expect(result.errors[0]?.message).toMatch(/값은 저장됐으나/);
      expect(result.errors[0]?.message).not.toMatch(/둘 다|저장하지 못했습니다.*새로고침.*확인/);
      const reread = await svc.getItem(owner, boardId, itemId);
      expect(reread.values[sidoKey]).toBe("부산");
      expect(reread.values[sigunguKey]).toBe("해운대구");
    } finally {
      realRepo.setValues = realSetValues;
    }
  });

  it("기존 setCells 부분저장 계약은 그대로 둔다", async () => {
    const { boardId, sidoKey, sigunguKey, itemId } = await makePairBoard();
    const columns = (await svc.getBoardDetail(owner, boardId)).columns;
    const sigunguCol = columns.find((c) => c.key === sigunguKey)!;
    await svc.updateColumn(owner, boardId, sigunguCol.id, { readOnly: true });
    const result = await svc.setCells(owner, boardId, itemId, {
      [sidoKey]: "부산",
      [sigunguKey]: "해운대구",
    });
    expect(result.errors.map((e) => e.key)).toEqual([sigunguKey]);
    expect(result.item.values[sidoKey]).toBe("부산");
    expect(result.item.values[sigunguKey]).toBe("강남구");
  });

  it("쓰기 성공 뒤 최종 재조회가 안 되면 unknown으로 닫고 단일 쓰기만 한다", async () => {
    const { boardId, sidoKey, sigunguKey, itemId } = await makePairBoard();
    const inner = svc as unknown as { repo: Promise<BoardsRepo> };
    const realRepo = await inner.repo;
    const realSetValues = realRepo.setValues.bind(realRepo);
    const realGetItem = realRepo.getItem.bind(realRepo);
    let writes = 0;
    let writeDone = false;
    realRepo.setValues = (async (ctx: Ctx, targetItemId: string, patch: Record<string, never>) => {
      writes += 1;
      const out = await realSetValues(ctx, targetItemId, patch);
      writeDone = true;
      return out;
    }) as typeof realRepo.setValues;
    realRepo.getItem = (async (ctx: Ctx, targetItemId: string) => {
      // 쓰기 전 두 번의 재조회는 통과시키고 최종 재조회만 실패시킨다 —
      // 단일 write 뒤 reread unavailable 순서.
      if (writeDone) throw new Error("reread unavailable");
      return realGetItem(ctx, targetItemId);
    }) as typeof realRepo.getItem;
    try {
      const result = await svc.setCellsStrict(
        owner,
        boardId,
        itemId,
        { [sidoKey]: "부산", [sigunguKey]: "해운대구" },
        crypto.randomUUID(),
        [sidoKey, sigunguKey],
      );
      expect(writes).toBe(1);
      expect(result.committed).toBe("unknown");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.message).toMatch(/저장됐을 수 있으나/);
      expect(result.errors[0]?.message).toMatch(/새로고침/);
      expect(result.errors[0]?.message).toMatch(/다시 저장하지 마세요/);
      // generic 성공 거짓말도 generic 미저장 거짓말도 아니다.
      expect(result.errors).not.toEqual([]);
      expect(result.commitDetail).toMatch(/확인하지 못했습니다/);
      // 저장 거부(none)와 문구가 다르다 — touch-실패(all)와도 구분된다.
      expect(result.errors[0]?.message).not.toMatch(/저장하지 못했습니다/);
      expect(result.errors[0]?.message).not.toMatch(/값은 저장됐으나 마무리 확인/);
    } finally {
      realRepo.setValues = realSetValues;
      realRepo.getItem = realGetItem;
    }
  });  it("write then touch failure plus reread failure reports unknown", async () => {
    const { boardId, sidoKey, sigunguKey, itemId } = await makePairBoard();
    const inner = svc as unknown as { repo: Promise<BoardsRepo> };
    const realRepo = await inner.repo;
    const realSetValues = realRepo.setValues.bind(realRepo);
    const realGetItem = realRepo.getItem.bind(realRepo);
    let writes = 0;
    let writeDone = false;
    realRepo.setValues = (async (ctx: Ctx, targetItemId: string, patch: Record<string, never>) => {
      writes += 1;
      const out = await realSetValues(ctx, targetItemId, patch);
      writeDone = true;
      void out;
      throw new Error("touch failed after commit");
    }) as typeof realRepo.setValues;
    realRepo.getItem = (async (ctx: Ctx, targetItemId: string) => {
      // 쓰기 전 두 번의 재조회는 통과시키고 최종 재조회만 실패시킨다 —
      // 단일 write 뒤 reread unavailable 순서.
      if (writeDone) throw new Error("reread unavailable");
      return realGetItem(ctx, targetItemId);
    }) as typeof realRepo.getItem;
    try {
      const result = await svc.setCellsStrict(
        owner,
        boardId,
        itemId,
        { [sidoKey]: "부산", [sigunguKey]: "해운대구" },
        crypto.randomUUID(),
        [sidoKey, sigunguKey],
      );
      expect(writes).toBe(1);
      expect(result.committed).toBe("unknown");
      expect(result.errors.length).toBeGreaterThan(0);

      expect(result.errors[0]?.message).toMatch(/새로고침/);

      // generic 성공 거짓말도 generic 미저장 거짓말도 아니다.
      expect(result.errors).not.toEqual([]);
      expect(result.commitDetail).toMatch(/확인하지 못했습니다/);
      // 저장 거부(none)와 문구가 다르다 — touch-실패(all)와도 구분된다.
      expect(result.errors[0]?.message).not.toMatch(/저장하지 못했습니다/);
      expect(result.errors[0]?.message).not.toMatch(/값은 저장됐으나 마무리 확인/);
    } finally {
      realRepo.setValues = realSetValues;
      realRepo.getItem = realGetItem;
    }
  });
});
