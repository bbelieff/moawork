/**
 * 2026-09-26 — «대기중 → 준비단계» 이동 규칙 추가의 회귀 테스트.
 *
 * 계약업체 실무 `progress_status` 규칙에 «대기중» 이 빠져 있어서, 대기중으로 되돌린
 * 카드가 진행중 그룹에 그대로 남았다. 정의(contract-work.ts) 수정만으로는 이미 깔린
 * 보드가 안 고쳐지므로, 기존 보드 런타임·additive repair 가 «빠진 쪽만» 메꾸는지와
 * 실제 상태 저장 → 그룹 복귀가 동작하는지를 여기서 못박는다.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { BoardsService } from "@/lib/boards/service";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import type { Ctx } from "@/lib/types";
import { CONTRACT_WORK_TAB } from "./contract-work";
import {
  ensureDefaultTab,
  ensureDefaultTabAdditive,
  planMoveRuleBackfill,
  readDefaultTabBoardDrift,
} from "./install";

const ctx = {
  org: { id: "org-waiting-backfill", name: "Test organization" },
  user: { id: "owner-waiting", name: "Owner", email: "owner@example.test" },
  role: "owner",
  scope: "all",
} as unknown as Ctx;

const assignees = [{ userId: "owner-waiting", displayName: "Owner" }] as const;

function columnOf(columns: readonly { key: string }[], key: string) {
  const column = columns.find((candidate) => candidate.key === key);
  if (!column) throw new Error(`컬럼 누락: ${key}`);
  return column as unknown as {
    id: string;
    key: string;
    move_rule_jsonb: Record<string, string>;
  };
}

beforeEach(() => {
  resetDb();
});

describe("planMoveRuleBackfill — 빠진 쪽만 메꾼다", () => {
  it("옛 4항 규칙에 대기중 → 준비단계를 더하고 기존 항목은 그대로 둔다", () => {
    const readyId = "group-ready";
    const progressId = "group-progress";
    const patches = planMoveRuleBackfill(
      CONTRACT_WORK_TAB,
      [{
        id: "col-progress",
        key: "progress_status",
        options_jsonb: {
          options: ["대기중", "진행중", "심사 중", "승인", "불가"].map((id, order) => ({ id, label: id, order })),
        },
        move_rule_jsonb: { "진행중": progressId },
      }],
      [
        { id: readyId, name: "⏹️준비단계" },
        { id: progressId, name: "▶️진행중" },
      ],
    );
    expect(patches).toHaveLength(1);
    expect(patches[0].columnId).toBe("col-progress");
    // 기존 항목은 손대지 않고 대기중만 더한다.
    expect(patches[0].moveRule).toEqual({ "진행중": progressId, "대기중": readyId });
  });

  it("회사가 바꾼 목적지는 덮어쓰지 않는다", () => {
    const patches = planMoveRuleBackfill(
      CONTRACT_WORK_TAB,
      [{
        id: "col-progress",
        key: "progress_status",
        options_jsonb: {
          options: ["대기중", "진행중"].map((id, order) => ({ id, label: id, order })),
        },
        // 회사가 진행중의 목적지를 다른 그룹으로 옮겼다.
        move_rule_jsonb: { "진행중": "group-custom" },
      }],
      [
        { id: "group-ready", name: "⏹️준비단계" },
        { id: "group-custom", name: "내가 만든 그룹" },
      ],
    );
    expect(patches).toHaveLength(1);
    expect(patches[0].moveRule).toEqual({ "진행중": "group-custom", "대기중": "group-ready" });
  });

  it("규칙이 통째로 비었으면 끄기로 읽고 손대지 않는다", () => {
    for (const empty of [null, {}]) {
      expect(planMoveRuleBackfill(
        CONTRACT_WORK_TAB,
        [{
          id: "col-progress",
          key: "progress_status",
          options_jsonb: { options: [{ id: "대기중", label: "대기중", order: 0 }] },
          move_rule_jsonb: empty,
        }],
        [{ id: "group-ready", name: "⏹️준비단계" }],
      )).toEqual([]);
    }
  });

  it("선택지에서 지운 값·이름이 바뀐 그룹은 추측으로 만들지 않는다", () => {
    // 대기중 선택지를 회사가 지웠다.
    expect(planMoveRuleBackfill(
      CONTRACT_WORK_TAB,
      [{
        id: "col-progress",
        key: "progress_status",
        options_jsonb: { options: [{ id: "진행중", label: "진행중", order: 0 }] },
        move_rule_jsonb: { "진행중": "group-progress" },
      }],
      [
        { id: "group-ready", name: "⏹️준비단계" },
        { id: "group-progress", name: "▶️진행중" },
      ],
    )).toEqual([]);
    // 준비단계 그룹을 알아볼 수 없게 바꿨다.
    expect(planMoveRuleBackfill(
      CONTRACT_WORK_TAB,
      [{
        id: "col-progress",
        key: "progress_status",
        options_jsonb: { options: [{ id: "대기중", label: "대기중", order: 0 }] },
        move_rule_jsonb: { "진행중": "group-progress" },
      }],
      [{ id: "group-other", name: "전혀 다른 그룹" }],
    )).toEqual([]);
  });
});

describe("기존 보드 repair — 대기중 규칙을 메꾼다", () => {
  /** 옛 보드 재현: 정의로 깔고 대기중 항목만 지운다. ID·그룹·선택지는 그대로. */
  async function installOldBoard() {
    const local = new LocalBoardsRepo();
    const store = toAsyncBoardsRepo(local);
    const ensured = await ensureDefaultTab(ctx, CONTRACT_WORK_TAB, store, [...assignees]);
    const columns = await store.listColumns(ctx, ensured.boardId);
    const status = columnOf(columns, "progress_status") as { id: string; move_rule_jsonb: Record<string, string> };
    const oldRule = { ...status.move_rule_jsonb };
    delete oldRule["대기중"];
    expect(oldRule).not.toHaveProperty("대기중");
    await store.updateColumn(ctx, status.id, { moveRule: oldRule });
    return { local, store, boardId: ensured.boardId };
  }

  it("드리프트 판정이 옛 규칙 보드를 «고칠 것 있음» 으로 본다", async () => {
    const { store, boardId } = await installOldBoard();
    const boards = await store.listBoards(ctx);
    const board = boards.find((candidate) => candidate.id === boardId)!;
    const drift = await readDefaultTabBoardDrift(ctx, CONTRACT_WORK_TAB, board, store, [...assignees]);
    expect(drift.hasWork).toBe(true);
  });

  it("additive repair 가 대기중 항목만 더하고 사용자 ID·그룹·선택지를 그대로 둔다", async () => {
    const { store, boardId } = await installOldBoard();
    const beforeGroups = await store.listGroups(ctx, boardId);
    const beforeColumns = await store.listColumns(ctx, boardId);
    const beforeStatus = columnOf(beforeColumns, "progress_status") as { id: string; move_rule_jsonb: Record<string, string> };

    await ensureDefaultTabAdditive(ctx, CONTRACT_WORK_TAB, store, [...assignees]);

    const afterColumns = await store.listColumns(ctx, boardId);
    const afterStatus = columnOf(afterColumns, "progress_status") as { move_rule_jsonb: Record<string, string> };
    const afterGroups = await store.listGroups(ctx, boardId);
    // 그룹·컬럼 ID 는 그대로다.
    expect(afterGroups.map((group) => group.id).sort()).toEqual(beforeGroups.map((group) => group.id).sort());
    expect(afterColumns.map((column) => column.id).sort()).toEqual(beforeColumns.map((column) => column.id).sort());
    // 옛 항목은 그대로, 대기중만 준비단계로 간다.
    expect(afterStatus.move_rule_jsonb).toEqual({
      ...beforeStatus.move_rule_jsonb,
      "대기중": afterGroups.find((group) => group.name.includes("준비단계"))!.id,
    });
    // 한 번 메꾸면 드리프트가 잠잠해진다(멱등).
    const boards = await store.listBoards(ctx);
    const drift = await readDefaultTabBoardDrift(
      ctx, CONTRACT_WORK_TAB, boards.find((candidate) => candidate.id === boardId)!, store, [...assignees],
    );
    expect(drift.hasWork).toBe(false);
  });
});

describe("실제 상태 저장 — 대기중으로 되돌리면 준비단계로 돌아간다", () => {
  it("progress_status=대기중 저장이 값과 그룹을 함께 옮긴다", async () => {
    const local = new LocalBoardsRepo();
    const store = toAsyncBoardsRepo(local);
    const svc = new BoardsService(store);
    const ensured = await ensureDefaultTab(ctx, CONTRACT_WORK_TAB, store, [...assignees]);
    const groups = await store.listGroups(ctx, ensured.boardId);
    const ready = groups.find((group) => group.name.includes("준비단계"))!;
    const progress = groups.find((group) => group.name.includes("진행중"))!;
    const item = await svc.createItem(ctx, ensured.boardId, { title: "대기 복귀 건", group_id: progress.id });

    const result = await svc.setCells(ctx, ensured.boardId, item.id, { progress_status: "대기중" });

    expect(result.errors).toEqual([]);
    expect(result.item.values.progress_status).toBe("대기중");
    expect(result.item.group_id).toBe(ready.id);
  });

  it("다른 상태의 기존 이동(승인 → 승인 그룹)은 그대로다", async () => {
    const local = new LocalBoardsRepo();
    const store = toAsyncBoardsRepo(local);
    const svc = new BoardsService(store);
    const ensured = await ensureDefaultTab(ctx, CONTRACT_WORK_TAB, store, [...assignees]);
    const groups = await store.listGroups(ctx, ensured.boardId);
    const ready = groups.find((group) => group.name.includes("준비단계"))!;
    const approved = groups.find((group) => group.name.includes("승인"))!;
    const item = await svc.createItem(ctx, ensured.boardId, { title: "승인 건", group_id: ready.id });

    const result = await svc.setCells(ctx, ensured.boardId, item.id, { progress_status: "승인" });

    expect(result.errors).toEqual([]);
    expect(result.item.values.progress_status).toBe("승인");
    expect(result.item.group_id).toBe(approved.id);
  });
});
