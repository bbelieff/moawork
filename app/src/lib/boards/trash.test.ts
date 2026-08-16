import { beforeEach, describe, expect, it } from "vitest";
import { BoardsService, NotFoundError } from "./service";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import { getRepo } from "@/lib/repo";
import { SEED_ORG_ID, SEED_USER_MEMBER, SEED_USER_OWNER } from "@/lib/repo/local/seed";
import type { Ctx, MemberRole, MemberScope } from "@/lib/types";

function ctxFor(userId: string, role: MemberRole, scope: MemberScope): Ctx {
  const repo = getRepo();
  const user = repo.getUser(userId);
  const org = repo.getOrg(SEED_ORG_ID);
  if (!user || !org) throw new Error("seed 누락");
  return { user, org, role, scope };
}

describe("BBE-168 board item trash and recovery", () => {
  let service: BoardsService;
  let owner: Ctx;
  let member: Ctx;

  beforeEach(() => {
    resetDb();
    service = new BoardsService(toAsyncBoardsRepo(new LocalBoardsRepo()));
    owner = ctxFor(SEED_USER_OWNER, "owner", "all");
    member = ctxFor(SEED_USER_MEMBER, "member", "assigned");
  });

  it("removes an item from active reads and restores every business field", async () => {
    const detail = await service.createBoard(owner, { name: "복구 검증" });
    const group = await service.addGroup(owner, detail.board.id, { name: "진행 중" });
    const note = await service.addColumn(owner, detail.board.id, { label: "복구 메모", type: "text" });
    const item = await service.createItem(owner, detail.board.id, {
      title: "보존할 항목",
      group_id: group.id,
      assigned_to: SEED_USER_MEMBER,
      values: { [note.key]: "삭제 전 값" },
    });
    const original = await service.getItem(owner, detail.board.id, item.id);

    await service.deleteItem(owner, detail.board.id, item.id);

    expect((await service.listItems(owner, detail.board.id)).some((row) => row.id === item.id)).toBe(false);
    await expect(service.getItem(owner, detail.board.id, item.id)).rejects.toBeInstanceOf(NotFoundError);
    const trashed = await service.listDeletedItems(owner, detail.board.id);
    expect(trashed).toHaveLength(1);
    expect(trashed[0]).toMatchObject({
      id: item.id,
      group_id: original.group_id,
      assigned_to: original.assigned_to,
      sort_order: original.sort_order,
      values: { [note.key]: "삭제 전 값" },
    });

    const restored = await service.restoreItem(owner, detail.board.id, item.id);
    expect(restored).toMatchObject({
      id: item.id,
      group_id: original.group_id,
      assigned_to: original.assigned_to,
      sort_order: original.sort_order,
      values: { [note.key]: "삭제 전 값" },
    });
    expect(await service.listDeletedItems(owner, detail.board.id)).toEqual([]);
    expect((await service.listItems(owner, detail.board.id)).some((row) => row.id === item.id)).toBe(true);
  });

  it("allows an assigned member but rejects other boards and organizations without mutation", async () => {
    const first = await service.createBoard(owner, { name: "첫 보드" });
    const second = await service.createBoard(owner, { name: "둘째 보드" });
    const assigned = await service.createItem(owner, first.board.id, {
      title: "담당 항목",
      assigned_to: SEED_USER_MEMBER,
    });
    const ownerOnly = await service.createItem(owner, first.board.id, { title: "오너 항목" });
    const foreign: Ctx = { ...owner, org: { ...owner.org, id: "org-foreign" } };

    await service.deleteItem(member, first.board.id, assigned.id);
    expect((await service.listDeletedItems(member, first.board.id)).map((row) => row.id)).toEqual([assigned.id]);
    await expect(service.restoreItem(member, second.board.id, assigned.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.restoreItem(foreign, first.board.id, assigned.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.deleteItem(member, first.board.id, ownerOnly.id)).rejects.toBeInstanceOf(NotFoundError);

    expect((await service.listDeletedItems(owner, first.board.id)).map((row) => row.id)).toEqual([assigned.id]);
    await service.restoreItem(member, first.board.id, assigned.id);
    expect((await service.listItems(member, first.board.id)).map((row) => row.id)).toContain(assigned.id);
  });

  it("replays repeated trash and restore commands without duplicating or losing data", async () => {
    const detail = await service.createBoard(owner, { name: "반복 명령" });
    const item = await service.createItem(owner, detail.board.id, { title: "한 번만" });

    await service.deleteItem(owner, detail.board.id, item.id);
    await expect(service.deleteItem(owner, detail.board.id, item.id)).resolves.toBeUndefined();
    expect(await service.listDeletedItems(owner, detail.board.id)).toHaveLength(1);
    await service.restoreItem(owner, detail.board.id, item.id);
    await expect(service.restoreItem(owner, detail.board.id, item.id)).resolves.toMatchObject({ id: item.id });
    expect((await service.listItems(owner, detail.board.id)).filter((row) => row.id === item.id)).toHaveLength(1);
  });
});
