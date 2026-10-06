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
  countLiveRowsByGroup,
  DEFAULT_TABS,
  ensureDefaultTab,
  ensureDefaultTabAdditive,
  findEmptyInstallerDuplicateGroups,
  planMoveRuleBackfill,
  readDefaultTabBoardDrift,
} from "./install";
import { plainGroupName } from "@/lib/boards/moveRules";

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

/**
 * 2026-10-06 운영 실측(테스트 워크스페이스, 읽기 전용 조회)과 같은 모양.
 *   · 회사가 기본 그룹 4개의 앞머리 이모지를 지웠다(⏹️ 준비단계 → 준비단계 …).
 *   · 설치기가 정확한 이름만 보고 «없다» 고 판정해 빈 복제를 다시 만들었다(sort 11~14).
 *   · 저장된 규칙 5개는 «이름 바뀐» 원래 그룹을 가리킨다.
 *   · 진행현황 선택지 14개(id = 라벨, 📂 포함).
 */
function productionShapedBoard() {
  const groups = [
    { id: "g0", name: "준비단계", sort_order: 0 },
    { id: "g1", name: "진행중", sort_order: 1 },
    { id: "g2", name: "심사 중", sort_order: 2 },
    { id: "g3", name: "승인", sort_order: 3 },
    { id: "g4", name: "📂 소진공 취약자금 접수예정", sort_order: 4 },
    { id: "g5", name: "📂 소진공 혁신성장 접수예정", sort_order: 5 },
    { id: "g6", name: "📂 소진공 일시적경영애로 접수예정", sort_order: 6 },
    { id: "g7", name: "📂 소진공 재도전 접수예정", sort_order: 7 },
    { id: "g8", name: "기업인증 진행", sort_order: 8 },
    { id: "g9", name: "관리중", sort_order: 9 },
    { id: "g10", name: "⛔ 대출불가", sort_order: 10 },
    { id: "d-ready-1", name: "⏹️ 준비단계", sort_order: 11 },
    { id: "d-ready-2", name: "⏹️ 준비단계", sort_order: 11 },
    { id: "d-ready-3", name: "⏹️ 준비단계", sort_order: 11 },
    { id: "d-progress-1", name: "▶️ 진행중", sort_order: 12 },
    { id: "d-progress-2", name: "▶️ 진행중", sort_order: 12 },
    { id: "d-progress-3", name: "▶️ 진행중", sort_order: 12 },
    { id: "d-review-1", name: "🔂 심사 중", sort_order: 13 },
    { id: "d-review-2", name: "🔂 심사 중", sort_order: 13 },
    { id: "d-approved-1", name: "💰 승인", sort_order: 14 },
  ];
  const options = CONTRACT_WORK_TAB.columns.find((column) => column.key === "progress_status")!.options!;
  const rule: Record<string, string> = { "불가": "g10", "승인": "g3", "대기중": "g0", "진행중": "g1", "심사 중": "g2" };
  const column = { id: "col-progress", key: "progress_status", options_jsonb: { options }, move_rule_jsonb: rule };
  return { groups, column, rule };
}

describe("2026-10-06 — 새 6개 규칙과 이름 바뀐 그룹", () => {
  it("운영 모양 보드에 빠진 6개 항목만 더하고 기존 5개·회사 그룹은 그대로 둔다", () => {
    const { groups, column, rule } = productionShapedBoard();
    const patches = planMoveRuleBackfill(CONTRACT_WORK_TAB, [column], groups);
    expect(patches).toHaveLength(1);
    expect(patches[0].moveRule).toEqual({
      ...rule,
      "관리중": "g9",
      "기업인증 진행": "g8",
      "📂소진공 혁신성장 대기": "g5",
      "📂소진공 신용취약 대기": "g4",
      "📂소진공 일시적경영애로 대기": "g6",
      "📂소진공 재도전 대기": "g7",
    });
    // 받아줄 그룹이 없는 3단계는 여전히 값만 바뀐다.
    for (const valueOnly of ["소공인(상생)", "해당연도 매출", "업체관리"]) {
      expect(patches[0].moveRule).not.toHaveProperty(valueOnly);
    }
  });

  it("빠진 대기중은 빈 «⏹️ 준비단계» 복제가 아니라 회사가 쓰는 «준비단계» 를 가리킨다", () => {
    // 옛 코드는 «정확한 이름 먼저» 라 sort 11 의 빈 복제를 골랐다.
    const { groups, column, rule } = productionShapedBoard();
    const withoutWaiting = { ...rule };
    delete withoutWaiting["대기중"];
    const patches = planMoveRuleBackfill(CONTRACT_WORK_TAB, [{ ...column, move_rule_jsonb: withoutWaiting }], groups);
    expect(patches[0].moveRule["대기중"]).toBe("g0");
  });

  it("후보가 여럿이면 기존 규칙이 가리키는 그룹 → 행이 있는 그룹 → 앞선 sort_order 순으로 고른다", () => {
    const options = [{ id: "대기중", label: "대기중", order: 0 }, { id: "진행중", label: "진행중", order: 1 }];
    // 앞선 sort 의 «준비단계» 와 뒤의 «⏹️ 준비단계» 가 같은 본문이다.
    const groups = [
      { id: "plain", name: "준비단계", sort_order: 0 },
      { id: "decorated", name: "⏹️ 준비단계", sort_order: 5 },
      { id: "progress", name: "진행중", sort_order: 1 },
    ];
    const column = { id: "c", key: "progress_status", options_jsonb: { options }, move_rule_jsonb: { "진행중": "progress" } };
    expect(planMoveRuleBackfill(CONTRACT_WORK_TAB, [column], groups)[0].moveRule["대기중"]).toBe("plain");
    // 행이 있는 쪽이 이긴다(앞선 «준비단계» 는 비었다).
    expect(planMoveRuleBackfill(CONTRACT_WORK_TAB, [column], groups, new Map([["decorated", 2]]))[0].moveRule["대기중"])
      .toBe("decorated");
    // 같은 컬럼의 다른 항목이 이미 가리키는 그룹이 가장 앞선다(회사가 실제로 쓰는 그룹).
    const pointed = { ...column, move_rule_jsonb: { "진행중": "progress", "업체관리": "decorated" } };
    expect(planMoveRuleBackfill(CONTRACT_WORK_TAB, [pointed], groups, new Map([["plain", 3]]))[0].moveRule["대기중"])
      .toBe("decorated");
  });

  it("실제 repair 는 행이 있는 그룹을 고른다(메꿀 것이 있을 때만 행을 읽는다)", async () => {
    const local = new LocalBoardsRepo();
    const store = toAsyncBoardsRepo(local);
    const svc = new BoardsService(store);
    const ensured = await ensureDefaultTab(ctx, CONTRACT_WORK_TAB, store, []);
    const groups = await store.listGroups(ctx, ensured.boardId);
    const ready = groups.find((group) => group.name === "⏹️ 준비단계")!;
    // 회사가 «준비단계» 로 고쳐 쓰다가 행을 옮겨 둔 그룹을 하나 더 만들었다 — 이름만 같다.
    const used = await store.createGroup(ctx, ensured.boardId, { name: "준비단계", sortOrder: 20 });
    await svc.createItem(ctx, ensured.boardId, { title: "쓰는 그룹 행", group_id: used.id });
    const status = columnOf(await store.listColumns(ctx, ensured.boardId), "progress_status");
    const rule = { ...status.move_rule_jsonb };
    delete rule["대기중"];
    await store.updateColumn(ctx, status.id, { moveRule: rule });

    await ensureDefaultTabAdditive(ctx, CONTRACT_WORK_TAB, store, []);

    const after = columnOf(await store.listColumns(ctx, ensured.boardId), "progress_status");
    expect(after.move_rule_jsonb["대기중"]).toBe(used.id);
    expect(after.move_rule_jsonb["대기중"]).not.toBe(ready.id);
  });
});

describe("2026-10-06 — 이름 바꾼 기본 그룹을 다시 만들지 않는다", () => {
  async function installAndRename(from: string, to: string) {
    const local = new LocalBoardsRepo();
    const store = toAsyncBoardsRepo(local);
    const ensured = await ensureDefaultTab(ctx, CONTRACT_WORK_TAB, store, []);
    const target = (await store.listGroups(ctx, ensured.boardId)).find((group) => group.name === from);
    if (!target) throw new Error(`그룹 누락: ${from}`);
    await store.updateGroup(ctx, ensured.boardId, target.id, { name: to });
    return { store, boardId: ensured.boardId, renamedId: target.id };
  }

  it("«🔂 심사 중» → «심사 중» 으로 바꿔도 드리프트가 «빠진 그룹» 으로 보지 않는다", async () => {
    const { store, boardId } = await installAndRename("🔂 심사 중", "심사 중");
    const board = (await store.listBoards(ctx)).find((candidate) => candidate.id === boardId)!;
    const drift = await readDefaultTabBoardDrift(ctx, CONTRACT_WORK_TAB, board, store, []);
    expect(drift.missingGroupNames).toEqual([]);
    // 2026-10-06(#845) — 서비스를 거치지 않은 이름 변경이라 단계 라벨이 아직 옛 이름이다 → 고칠 일은 «라벨 맞추기» 뿐.
    expect(drift.hasWork).toBe(true);
    await ensureDefaultTabAdditive(ctx, CONTRACT_WORK_TAB, store, []);
    expect(await store.listGroups(ctx, boardId)).toHaveLength(14);
    const status = (await store.listColumns(ctx, boardId)).find((column) => column.key === "progress_status")!;
    expect(status.options_jsonb?.options.find((option) => option.id === "심사 중")?.label).toBe("심사 중");
    const after = await readDefaultTabBoardDrift(ctx, CONTRACT_WORK_TAB, board, store, []);
    expect(after.hasWork).toBe(false);
  });

  it("진입 repair(additive)와 부트스트랩 보장 모두 빈 복제를 만들지 않는다", async () => {
    const { store, boardId, renamedId } = await installAndRename("⏹️ 준비단계", "준비단계");
    const ensuredAdditive = await ensureDefaultTabAdditive(ctx, CONTRACT_WORK_TAB, store, []);
    expect(await store.listGroups(ctx, boardId)).toHaveLength(14);
    // 정의 이름 → 실제 그룹 매핑도 이름 바뀐 원래 그룹을 가리킨다.
    expect(ensuredAdditive.groupIds["⏹️ 준비단계"]).toBe(renamedId);
    await ensureDefaultTab(ctx, CONTRACT_WORK_TAB, store, []);
    expect(await store.listGroups(ctx, boardId)).toHaveLength(14);
  });

  it("본문이 다른 이름도 단계 규칙이 그 그룹을 잇고 있으면 같은 그룹이다(#845 — 연결로 찾는다)", async () => {
    const { store, boardId } = await installAndRename("🔂 심사 중", "심사 완료");
    const board = (await store.listBoards(ctx)).find((candidate) => candidate.id === boardId)!;
    const drift = await readDefaultTabBoardDrift(ctx, CONTRACT_WORK_TAB, board, store, []);
    expect(drift.missingGroupNames).toEqual([]);
  });

  it("단계 규칙을 끈 보드(연결 근거 없음)에서는 본문이 다른 이름을 여전히 «빠진 것» 으로 본다", async () => {
    const { store, boardId } = await installAndRename("🔂 심사 중", "심사 완료");
    const status = (await store.listColumns(ctx, boardId)).find((column) => column.key === "progress_status")!;
    await store.updateColumn(ctx, status.id, { moveRule: {} });
    const board = (await store.listBoards(ctx)).find((candidate) => candidate.id === boardId)!;
    const drift = await readDefaultTabBoardDrift(ctx, CONTRACT_WORK_TAB, board, store, []);
    expect(drift.missingGroupNames).toEqual(["🔂 심사 중"]);
  });

  it("규칙이 «지워진» 그룹을 가리키면 연결 근거가 아니다 — 살아 있는 그룹만 같은 그룹으로 본다", async () => {
    const { store, boardId, renamedId } = await installAndRename("🔂 심사 중", "심사 완료");
    await store.deleteGroup(ctx, renamedId);
    const status = (await store.listColumns(ctx, boardId)).find((column) => column.key === "progress_status")!;
    expect(status.move_rule_jsonb?.["심사 중"]).toBe(renamedId);
    const board = (await store.listBoards(ctx)).find((candidate) => candidate.id === boardId)!;
    const drift = await readDefaultTabBoardDrift(ctx, CONTRACT_WORK_TAB, board, store, []);
    expect(drift.missingGroupNames).toEqual(["🔂 심사 중"]);
  });

  it("기본 탭마다 정의 그룹의 본문 이름이 서로 겹치지 않는다 — 한 그룹을 두 정의가 나눠 갖지 않는다", () => {
    for (const tab of DEFAULT_TABS) {
      const plain = tab.groups.filter((group) => group.assigneeSlot === undefined).map((group) => plainGroupName(group.name));
      expect(new Set(plain).size, tab.key).toBe(plain.length);
    }
  });
});

describe("findEmptyInstallerDuplicateGroups — 빈 설치기 복제만 가려낸다(지우지 않는다)", () => {
  it("운영 모양 보드에서 빈 복제 9개만 고르고 원래 그룹은 고르지 않는다", () => {
    const { groups, column } = productionShapedBoard();
    const rows = countLiveRowsByGroup([
      { group_id: "g0" }, { group_id: "g2" }, { group_id: "g2" }, { group_id: "g3" },
      // 휴지통·보관 행은 «살아 있는 행» 이 아니다.
      { group_id: "d-review-2", deleted_at: "2026-10-01T00:00:00Z" },
      { group_id: "d-approved-1", archived_at: "2026-10-01T00:00:00Z" },
    ]);
    const duplicates = findEmptyInstallerDuplicateGroups(CONTRACT_WORK_TAB, groups, rows, [column]);
    expect(duplicates.map((duplicate) => duplicate.groupId).sort()).toEqual([
      "d-approved-1", "d-progress-1", "d-progress-2", "d-progress-3",
      "d-ready-1", "d-ready-2", "d-ready-3", "d-review-1", "d-review-2",
    ]);
    expect(Object.fromEntries(duplicates.map((duplicate) => [duplicate.groupId, duplicate.keeperGroupId]))).toMatchObject({
      "d-ready-1": "g0", "d-progress-2": "g1", "d-review-1": "g2", "d-approved-1": "g3",
    });
  });

  it("행이 있거나·규칙이 가리키거나·회사가 만든 이름이거나·가장 앞선 그룹이면 남긴다", () => {
    const groups = [
      { id: "orig", name: "심사 중", sort_order: 2 },
      { id: "dup-rows", name: "🔂 심사 중", sort_order: 13 },
      { id: "dup-ruled", name: "🔂 심사 중", sort_order: 14 },
      { id: "user", name: "심사 중", sort_order: 15 },
      { id: "first", name: "💰 승인", sort_order: 3 },
      { id: "later-plain", name: "승인", sort_order: 9 },
    ];
    const duplicates = findEmptyInstallerDuplicateGroups(
      CONTRACT_WORK_TAB,
      groups,
      new Map([["dup-rows", 1]]),
      [{ move_rule_jsonb: { "심사 중": "dup-ruled" } }],
    );
    // user: 정의 이름과 정확히 같지 않다(설치기가 만든 이름이 아니다).
    // first: 같은 본문 중 가장 앞선 그룹이다.
    expect(duplicates).toEqual([]);
  });
});
