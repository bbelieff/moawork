/**
 * 2026-10-06(#845) — 이미 깔린 계약업체 실무 보드가 «단계 = 보드 그룹» 으로 수렴하는가.
 *
 *   · 진입 repair(ensureDefaultTabAdditive)·부트스트랩 보장(ensureDefaultTab)이 새 3그룹을 붙이고
 *     (본문 이름이 같은 그룹이 있으면 만들지 않는다) 같은 이름 단계의 규칙을 잇고, 단계 라벨·순서를 그룹에 맞춘다.
 *   · 선택지 id 는 그대로다 — 저장된 값이 계속 유효하다.
 *   · 운영 모양(이름 바뀐 원래 그룹 + 빈 설치기 복제 9개)에서 복제는 단계를 받지 않는다(지우지도 않는다).
 *   · 드리프트 판정이 «라벨·순서 어긋남» 을 고칠 일로 보고, 고친 뒤에는 잠잠하다(두 번째 repair 는 쓰기 0).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoardsService } from "@/lib/boards/service";
import { stageOptionIdForGroup } from "@/lib/boards/moveRules";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import type { Ctx } from "@/lib/types";
import { CONTRACT_WORK_TAB } from "./contract-work";
import {
  ensureDefaultTab,
  ensureDefaultTabAdditive,
  readDefaultTabBoardDrift,
  readDefaultTabBootstrapDrift,
} from "./install";
import { groupLinkedStageColumnKey, isGroupLinkedStageColumn, planLinkedStageSync } from "@/lib/boards/stage-link";

const ctx = {
  org: { id: "org-stage-link", name: "Test organization" },
  user: { id: "owner-stage-link", name: "Owner", email: "owner@example.test" },
  role: "owner",
  scope: "all",
} as unknown as Ctx;

const ADDED = ["소공인(상생)", "해당연도 매출", "업체관리"] as const;
const DEFINITION_OPTIONS = CONTRACT_WORK_TAB.columns.find((column) => column.key === "progress_status")!.options!;

beforeEach(() => {
  resetDb();
});

/** #845 이전 보드: 그룹 11개, 규칙 11개, 단계 라벨 = 먼데이 사전 라벨. */
async function preLinkBoard() {
  const local = new LocalBoardsRepo();
  const store = toAsyncBoardsRepo(local);
  const svc = new BoardsService(store);
  const { boardId } = await ensureDefaultTab(ctx, CONTRACT_WORK_TAB, store, []);
  const groups = await store.listGroups(ctx, boardId);
  for (const name of ADDED) await store.deleteGroup(ctx, groups.find((group) => group.name === name)!.id);
  const status = (await store.listColumns(ctx, boardId)).find((column) => column.key === "progress_status")!;
  const rule = { ...status.move_rule_jsonb };
  for (const name of ADDED) delete rule[name];
  await store.updateColumn(ctx, status.id, { options: DEFINITION_OPTIONS.map((option) => ({ ...option })), moveRule: rule });
  const board = (await store.listBoards(ctx)).find((candidate) => candidate.id === boardId)!;
  const stage = async () => (await store.listColumns(ctx, boardId)).find((column) => column.key === "progress_status")!;
  return { local, store, svc, boardId, board, stage };
}

describe("이미 깔린 보드의 수렴 — 진입 repair", () => {
  it("새 3그룹을 맨 뒤에 붙이고, 같은 이름 단계를 잇고, 단계 라벨·순서를 그룹에 맞춘다(id 는 그대로)", async () => {
    const { store, svc, boardId, board, stage } = await preLinkBoard();
    const groupsBefore = await store.listGroups(ctx, boardId);
    const item = await svc.createItem(ctx, boardId, {
      title: "혁신성장 건",
      group_id: groupsBefore.find((group) => group.name === "📂 소진공 혁신성장 접수예정")!.id,
      values: { progress_status: "📂소진공 혁신성장 대기" },
    });
    expect((await readDefaultTabBoardDrift(ctx, CONTRACT_WORK_TAB, board, store, [])).hasWork).toBe(true);

    await ensureDefaultTabAdditive(ctx, CONTRACT_WORK_TAB, store, []);

    const groups = await store.listGroups(ctx, boardId);
    expect(groups.map((group) => group.name).slice(-3)).toEqual([...ADDED]);
    const column = await stage();
    const rule = column.move_rule_jsonb!;
    for (const name of ADDED) expect(rule[name], name).toBe(groups.find((group) => group.name === name)!.id);
    expect(column.options_jsonb!.options.map((option) => option.label)).toEqual(groups.map((group) => group.name));
    expect(column.options_jsonb!.options.map((option) => rule[option.id])).toEqual(groups.map((group) => group.id));
    expect(new Set(column.options_jsonb!.options.map((option) => option.id))).toEqual(new Set(DEFINITION_OPTIONS.map((option) => option.id)));
    // 신용취약 ↔ 취약자금은 같은 것이다(#845 결정 3) — 그 그룹의 단계 라벨이 그룹 이름이 된다.
    expect(column.options_jsonb!.options.find((option) => option.id === "📂소진공 신용취약 대기")?.label).toBe("📂 소진공 취약자금 접수예정");
    // 저장된 값은 그대로 유효하다.
    expect((await svc.getItem(ctx, boardId, item.id)).values.progress_status).toBe("📂소진공 혁신성장 대기");
  });

  it("한 번 고치면 드리프트가 잠잠하고, 두 번째 repair 는 컬럼을 쓰지 않는다", async () => {
    const { local, store, board } = await preLinkBoard();
    await ensureDefaultTabAdditive(ctx, CONTRACT_WORK_TAB, store, []);
    expect((await readDefaultTabBoardDrift(ctx, CONTRACT_WORK_TAB, board, store, [])).hasWork).toBe(false);

    const writes = vi.spyOn(local, "updateColumn");
    const groupWrites = vi.spyOn(local, "createGroup");
    await ensureDefaultTabAdditive(ctx, CONTRACT_WORK_TAB, store, []);
    expect(writes).not.toHaveBeenCalled();
    expect(groupWrites).not.toHaveBeenCalled();
  });

  it("부트스트랩 보장(ensureDefaultTab)도 같은 결과로 수렴하고, 그 뒤 읽기 전용 드리프트 검사는 깨끗하다", async () => {
    const { store, boardId, board, stage } = await preLinkBoard();
    expect((await readDefaultTabBootstrapDrift(ctx, CONTRACT_WORK_TAB, board, store, [])).hasWork).toBe(true);

    await ensureDefaultTab(ctx, CONTRACT_WORK_TAB, store, []);

    const groups = await store.listGroups(ctx, boardId);
    expect((await stage()).options_jsonb!.options.map((option) => option.label)).toEqual(groups.map((group) => group.name));
    expect((await readDefaultTabBootstrapDrift(ctx, CONTRACT_WORK_TAB, board, store, [])).hasWork).toBe(false);
    expect((await readDefaultTabBoardDrift(ctx, CONTRACT_WORK_TAB, board, store, [])).hasWork).toBe(false);
  });
});

describe("운영 모양 — 이름 바뀐 원래 그룹 + 빈 설치기 복제 9개", () => {
  async function productionShapedBoard() {
    const fixture = await preLinkBoard();
    const { store, svc, boardId } = fixture;
    const groups = await store.listGroups(ctx, boardId);
    const renamed = new Map([["⏹️ 준비단계", "준비단계"], ["▶️ 진행중", "진행중"], ["🔂 심사 중", "심사 중"], ["💰 승인", "승인"]]);
    for (const [from, to] of renamed) await store.updateGroup(ctx, boardId, groups.find((group) => group.name === from)!.id, { name: to });
    for (const [rowGroup, value] of [["준비단계", "대기중"], ["심사 중", "심사 중"], ["승인", "승인"]] as const) {
      const target = (await store.listGroups(ctx, boardId)).find((group) => group.name === rowGroup)!;
      await svc.createItem(ctx, boardId, { title: `${rowGroup} 건`, group_id: target.id, values: { progress_status: value } });
    }
    const duplicates = [];
    for (const [name, count] of [["⏹️ 준비단계", 3], ["▶️ 진행중", 3], ["🔂 심사 중", 2], ["💰 승인", 1]] as const) {
      for (let index = 0; index < count; index += 1) duplicates.push(await store.createGroup(ctx, boardId, { name, sortOrder: 20 + duplicates.length }));
    }
    return { ...fixture, duplicates };
  }

  it("복제는 단계를 받지 않고(지우지도 않는다), 단계 라벨은 회사가 바꾼 이름을 따른다", async () => {
    const { store, boardId, stage, duplicates } = await productionShapedBoard();

    await ensureDefaultTabAdditive(ctx, CONTRACT_WORK_TAB, store, []);

    const groups = await store.listGroups(ctx, boardId);
    for (const duplicate of duplicates) expect(groups.some((group) => group.id === duplicate.id)).toBe(true);
    const column = await stage();
    const targets = new Set(Object.values(column.move_rule_jsonb!));
    for (const duplicate of duplicates) {
      expect(targets.has(duplicate.id), duplicate.name).toBe(false);
      expect(column.options_jsonb!.options.some((option) => option.id === stageOptionIdForGroup(duplicate.id))).toBe(false);
    }
    expect(column.options_jsonb!.options).toHaveLength(14);
    const label = (id: string) => column.options_jsonb!.options.find((option) => option.id === id)?.label;
    expect([label("대기중"), label("진행중"), label("심사 중"), label("승인")]).toEqual(["준비단계", "진행중", "심사 중", "승인"]);
    // 새 3그룹은 복제 뒤에 붙는다(회사 순서를 건드리지 않는다). 단계 순서도 그 그룹 순서를 따른다.
    expect(column.options_jsonb!.options.slice(-3).map((option) => option.id)).toEqual([...ADDED]);
    expect((await readDefaultTabBoardDrift(ctx, CONTRACT_WORK_TAB, (await store.listBoards(ctx))[0], store, [])).hasWork).toBe(false);
  });

  it("옛 백필이 «대기중» 을 빈 복제에 이어 뒀으면 회사가 쓰는 원래 그룹으로 옮긴다", async () => {
    const { store, boardId, stage, duplicates } = await productionShapedBoard();
    const status = await stage();
    await store.updateColumn(ctx, status.id, { moveRule: { ...status.move_rule_jsonb, "대기중": duplicates[0].id } });

    await ensureDefaultTabAdditive(ctx, CONTRACT_WORK_TAB, store, []);

    const ready = (await store.listGroups(ctx, boardId)).find((group) => group.name === "준비단계")!;
    const column = await stage();
    expect(column.move_rule_jsonb!["대기중"]).toBe(ready.id);
    expect(column.options_jsonb!.options.filter((option) => column.move_rule_jsonb![option.id] === ready.id).map((option) => option.label))
      .toEqual(["준비단계"]);
  });

  it("부트스트랩 읽기 전용 검사는 행을 읽지 않는다 — 복제가 남아 있어도 이미 맞춘 보드는 깨끗하다", async () => {
    // 그 검사는 캐시된 그룹·컬럼 밖의 모든 호출(행 읽기 포함)을 «고칠 것 있음» 으로 본다.
    // 그래서 hasWork=false 는 «행을 읽지 않고도 바꿀 것이 없다고 판정했다» 는 뜻이다.
    const { store, board } = await productionShapedBoard();
    await ensureDefaultTabAdditive(ctx, CONTRACT_WORK_TAB, store, []);

    expect((await readDefaultTabBootstrapDrift(ctx, CONTRACT_WORK_TAB, board, store, [])).hasWork).toBe(false);
  });
});

describe("stage-link — 어느 칸이 연결돼 있나", () => {
  it("계약업체 실무의 progress_status 만, 이동 규칙이 켜져 있을 때만 연결된다", () => {
    expect(groupLinkedStageColumnKey(CONTRACT_WORK_TAB.source)).toBe("progress_status");
    expect(groupLinkedStageColumnKey("core.default-tab/contact")).toBeNull();
    expect(groupLinkedStageColumnKey(null)).toBeNull();
    const head = { key: "progress_status", type: "status" as const, move_rule_jsonb: { "승인": "g" } };
    expect(isGroupLinkedStageColumn(CONTRACT_WORK_TAB.source, head)).toBe(true);
    expect(isGroupLinkedStageColumn(CONTRACT_WORK_TAB.source, { ...head, move_rule_jsonb: {} })).toBe(false);
    expect(isGroupLinkedStageColumn(CONTRACT_WORK_TAB.source, { ...head, key: "engagement_kind" })).toBe(false);
    expect(isGroupLinkedStageColumn("core.default-tab/new-lead", head)).toBe(false);
  });

  it("연결되지 않은 보드에는 계획이 없다", () => {
    const column = {
      id: "c", key: "progress_status", type: "status" as const,
      options_jsonb: { options: [{ id: "a", label: "a" }] }, move_rule_jsonb: { a: "g" },
    };
    expect(planLinkedStageSync("core.default-tab/contact", [column], [{ id: "g", name: "다른 이름", sort_order: 0 }])).toBeNull();
    expect(planLinkedStageSync(CONTRACT_WORK_TAB.source, [column], [{ id: "g", name: "다른 이름", sort_order: 0 }])).toMatchObject({
      columnId: "c",
      options: [{ id: "a", label: "다른 이름", order: 0 }],
    });
  });
});
