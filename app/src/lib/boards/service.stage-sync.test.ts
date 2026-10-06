/**
 * 2026-10-06 제품 책임자 결정(#845) — 띠(그룹)와 진행현황 단계는 «연결» 돼 있다.
 *
 * 그룹을 더하거나·이름을 바꾸거나·순서를 바꾸면(BoardsService 의 세 그룹 쓰기 — 보드 화면·띠 제목·
 * 워크스페이스 빌더·섹션 프리셋이 모두 이 길을 지난다) 진행현황 단계 목록이 그대로 따라온다.
 * 선택지 id 는 바뀌지 않으므로 저장된 값은 계속 유효하다. 연결된 칸의 선택지를 손으로 고치는 길은 막는다.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoardsService } from "./service";
import { stageOptionIdForGroup } from "./moveRules";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import { CONTRACT_WORK_TAB } from "@/lib/default-tabs/contract-work";
import { ensureDefaultTab } from "@/lib/default-tabs/install";
import { LINKED_STAGE_EDIT_MESSAGE } from "./stage-link";
import type { Ctx } from "@/lib/types";

const owner = {
  org: { id: "org-stage-sync", name: "Test organization" },
  user: { id: "owner-stage-sync", name: "Owner", email: "owner@example.test" },
  role: "owner",
  scope: "all",
} as unknown as Ctx;

beforeEach(() => {
  resetDb();
});

async function contractWorkBoard() {
  const local = new LocalBoardsRepo();
  const store = toAsyncBoardsRepo(local);
  const svc = new BoardsService(store);
  const { boardId } = await ensureDefaultTab(owner, CONTRACT_WORK_TAB, store, []);
  const groups = async () => store.listGroups(owner, boardId);
  const group = async (name: string) => {
    const found = (await groups()).find((candidate) => candidate.name === name);
    if (!found) throw new Error(`그룹 누락: ${name}`);
    return found;
  };
  const stage = async () => (await store.listColumns(owner, boardId)).find((column) => column.key === "progress_status")!;
  return { local, store, svc, boardId, groups, group, stage };
}

describe("그룹 → 진행현황 단계 연결", () => {
  it("그룹 이름을 바꾸면 그 그룹의 단계 라벨이 바뀐다 — 선택지 id·저장된 값은 그대로다", async () => {
    const { svc, boardId, group, stage } = await contractWorkBoard();
    const review = await group("🔂 심사 중");
    const item = await svc.createItem(owner, boardId, { title: "심사 건", group_id: review.id, values: { progress_status: "심사 중" } });

    await svc.renameGroup(owner, boardId, review.id, "1차 심사");

    const options = (await stage()).options_jsonb!.options;
    expect(options.find((option) => option.id === "심사 중")?.label).toBe("1차 심사");
    expect(options.map((option) => option.id)).toContain("심사 중");
    expect((await svc.getItem(owner, boardId, item.id)).values.progress_status).toBe("심사 중");
    expect((await stage()).move_rule_jsonb?.["심사 중"]).toBe(review.id);
  });

  it("그룹 순서를 바꾸면 단계 순서가 같은 순서가 된다", async () => {
    const { svc, boardId, groups, stage } = await contractWorkBoard();
    const reversed = [...await groups()].reverse();

    await svc.reorderGroups(owner, boardId, reversed.map((group) => group.id));

    const rule = (await stage()).move_rule_jsonb!;
    expect((await stage()).options_jsonb!.options.map((option) => rule[option.id])).toEqual(reversed.map((group) => group.id));
  });

  it("그룹을 더하면 새 단계와 이동 규칙이 생기고, 그 단계를 고르면 행이 새 그룹으로 간다", async () => {
    const { svc, boardId, group, stage } = await contractWorkBoard();
    const created = await svc.addGroup(owner, boardId, { name: "보완 서류 대기" });
    const optionId = stageOptionIdForGroup(created.id);

    const column = await stage();
    expect(column.options_jsonb!.options.at(-1)).toMatchObject({ id: optionId, label: "보완 서류 대기" });
    expect(column.move_rule_jsonb?.[optionId]).toBe(created.id);

    const item = await svc.createItem(owner, boardId, { title: "보완 건", group_id: (await group("🔂 심사 중")).id });
    const result = await svc.setCells(owner, boardId, item.id, { progress_status: optionId });
    expect(result.errors).toEqual([]);
    expect(result.item.group_id).toBe(created.id);
    expect(result.item.values.progress_status).toBe(optionId);
  });

  it("새 그룹·이름 바꾼 그룹으로 드래그하면 그 그룹의 단계가 값이 된다(역동기화와 이어진다)", async () => {
    const { svc, boardId, group } = await contractWorkBoard();
    const review = await group("🔂 심사 중");
    const approved = await group("💰 승인");
    await svc.renameGroup(owner, boardId, approved.id, "최종 승인");
    const extra = await svc.addGroup(owner, boardId, { name: "보완 서류 대기" });
    const version = async () => (await svc.getBoardDetail(owner, boardId)).board.row_order_version ?? 0;
    const first = await svc.createItem(owner, boardId, { title: "a", group_id: review.id, values: { progress_status: "심사 중" } });
    const second = await svc.createItem(owner, boardId, { title: "b", group_id: review.id, values: { progress_status: "심사 중" } });

    await svc.moveRowAtomic(owner, boardId, { itemId: first.id, targetGroupId: approved.id, beforeItemId: null, expectedVersion: await version(), requestId: crypto.randomUUID() });
    await svc.moveRowAtomic(owner, boardId, { itemId: second.id, targetGroupId: extra.id, beforeItemId: null, expectedVersion: await version(), requestId: crypto.randomUUID() });

    expect((await svc.getItem(owner, boardId, first.id)).values.progress_status).toBe("승인");
    expect((await svc.getItem(owner, boardId, second.id)).values.progress_status).toBe(stageOptionIdForGroup(extra.id));
  });

  it("바뀔 것이 없으면 쓰지 않는다 — 같은 이름으로 다시 저장해도 컬럼 쓰기 0", async () => {
    const { local, svc, boardId, group } = await contractWorkBoard();
    const review = await group("🔂 심사 중");
    const writes = vi.spyOn(local, "updateColumn");

    await svc.renameGroup(owner, boardId, review.id, "🔂 심사 중");

    expect(writes).not.toHaveBeenCalled();
  });

  it("빈 설치기 복제(이름 바뀐 원래 그룹 뒤에 다시 생긴 빈 «⏹️ 준비단계»)는 단계를 받지 않는다", async () => {
    const { store, svc, boardId, group, stage } = await contractWorkBoard();
    const ready = await group("⏹️ 준비단계");
    await svc.createItem(owner, boardId, { title: "준비 건", group_id: ready.id, values: { progress_status: "대기중" } });
    await svc.renameGroup(owner, boardId, ready.id, "준비단계");
    // 옛 설치기가 «없다» 고 보고 다시 만든 빈 복제(정의 이름 그대로, 맨 뒤).
    const duplicate = await store.createGroup(owner, boardId, { name: "⏹️ 준비단계", sortOrder: 40 });

    await svc.renameGroup(owner, boardId, (await group("▶️ 진행중")).id, "진행중");

    const column = await stage();
    expect(Object.values(column.move_rule_jsonb!)).not.toContain(duplicate.id);
    expect(column.options_jsonb!.options.some((option) => option.id === stageOptionIdForGroup(duplicate.id))).toBe(false);
    expect(column.options_jsonb!.options.find((option) => option.id === "대기중")?.label).toBe("준비단계");
    expect(column.options_jsonb!.options).toHaveLength(14);
  });

  it("단계 동기화가 실패해도 이미 커밋된 그룹 이름 변경을 실패로 바꾸지 않는다", async () => {
    const { local, svc, boardId, group } = await contractWorkBoard();
    const review = await group("🔂 심사 중");
    vi.spyOn(local, "updateColumn").mockImplementation(() => {
      throw new Error("network lost");
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(svc.renameGroup(owner, boardId, review.id, "1차 심사")).resolves.toMatchObject({ name: "1차 심사" });
    expect(logged).toHaveBeenCalled();
  });

  it("계약업체 실무가 아닌 보드의 그룹 변경은 단계 칸을 건드리지 않는다", async () => {
    const local = new LocalBoardsRepo();
    const svc = new BoardsService(toAsyncBoardsRepo(local));
    const detail = await svc.createBoard(owner, { name: "일반 보드" });
    const waiting = await svc.addGroup(owner, detail.board.id, { name: "대기" });
    const column = await svc.addColumn(owner, detail.board.id, {
      label: "상태", type: "select", options: [{ id: "wait", label: "대기", order: 0 }], moveRule: { wait: waiting.id },
    });
    const writes = vi.spyOn(local, "updateColumn");

    await svc.renameGroup(owner, detail.board.id, waiting.id, "보류");
    await svc.addGroup(owner, detail.board.id, { name: "완료" });

    expect(writes).not.toHaveBeenCalled();
    expect((await svc.getBoardDetail(owner, detail.board.id)).columns.find((candidate) => candidate.id === column.id)?.options_jsonb?.options)
      .toEqual([{ id: "wait", label: "대기", order: 0 }]);
  });
});

describe("연결된 단계 칸은 손으로 고치지 않는다", () => {
  it("선택지·이동 규칙 수정은 안내와 함께 거절하고 아무것도 쓰지 않는다", async () => {
    const { local, svc, boardId, stage } = await contractWorkBoard();
    const column = await stage();
    const writes = vi.spyOn(local, "updateColumn");

    await expect(svc.updateColumn(owner, boardId, column.id, { options: [{ id: "승인", label: "다른 이름", order: 0 }] }))
      .rejects.toThrow(LINKED_STAGE_EDIT_MESSAGE);
    await expect(svc.updateColumn(owner, boardId, column.id, { moveRule: {} })).rejects.toThrow(LINKED_STAGE_EDIT_MESSAGE);
    expect(writes).not.toHaveBeenCalled();
  });

  it("폭 같은 다른 설정·다른 칸의 선택지는 그대로 고칠 수 있다", async () => {
    const { svc, boardId, store } = await contractWorkBoard();
    const columns = await store.listColumns(owner, boardId);
    const status = columns.find((column) => column.key === "progress_status")!;
    const kind = columns.find((column) => column.key === "engagement_kind")!;

    await expect(svc.updateColumn(owner, boardId, status.id, { width: 200 })).resolves.toMatchObject({ width: 200 });
    await expect(svc.updateColumn(owner, boardId, kind.id, { options: [{ id: "자금", label: "자금", order: 0 }] }))
      .resolves.toMatchObject({ key: "engagement_kind" });
  });
});
