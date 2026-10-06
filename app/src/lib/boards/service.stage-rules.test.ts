/**
 * 2026-10-06 — 진행현황(계약업체 실무) 단계 ↔ 그룹 정합.
 *
 *   [1] 그룹을 옮기는 단계 변경이 실패할 때: 권한 사전 확인 · 낡은 버전 1회 재시도 ·
 *       옮길 그룹이 없으면 값만 저장 · 아는 실패는 사람 말로.
 *   [3] 행을 다른 그룹으로 옮기면(드래그·행별 이동·일괄 이동·키보드 = moveRowAtomic 한 경로)
 *       진행현황도 그 그룹의 대표 단계로 맞춘다 — 같은 원자 RPC, 같은 requestId 재생 의미.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoardsService } from "./service";
import { ROW_MOVE_FAILURE_MESSAGES, ROW_MOVE_VALUE_ONLY_NOTICE, UserFacingActionError } from "./boardActionFlash";
import type { AtomicValueMoveRequest } from "./store";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import { CONTRACT_WORK_TAB } from "@/lib/default-tabs/contract-work";
import { ensureDefaultTab } from "@/lib/default-tabs/install";
import type { Ctx } from "@/lib/types";

const owner = {
  org: { id: "org-stage-rules", name: "Test organization" },
  user: { id: "owner-stage", name: "Owner", email: "owner@example.test" },
  role: "owner",
  scope: "all",
} as unknown as Ctx;

const member = {
  org: owner.org,
  user: { id: "member-stage", name: "Member", email: "member@example.test" },
  role: "member",
  scope: "assigned",
} as unknown as Ctx;

beforeEach(() => {
  resetDb();
});

async function contractWorkBoard() {
  const local = new LocalBoardsRepo();
  const store = toAsyncBoardsRepo(local);
  const svc = new BoardsService(store);
  const ensured = await ensureDefaultTab(owner, CONTRACT_WORK_TAB, store, []);
  const groups = await store.listGroups(owner, ensured.boardId);
  const group = (name: string) => {
    const found = groups.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`그룹 누락: ${name}`);
    return found;
  };
  const version = async () => (await store.getBoard(owner, ensured.boardId))?.row_order_version ?? 0;
  return { local, store, svc, boardId: ensured.boardId, group, version };
}

describe("[3] 행을 다른 그룹으로 옮기면 진행현황도 맞춘다", () => {
  it("심사 중 → 승인 드래그가 값과 그룹을 한 번에 바꾼다", async () => {
    const { svc, boardId, group, version } = await contractWorkBoard();
    const item = await svc.createItem(owner, boardId, { title: "드래그 건", group_id: group("🔂 심사 중").id, values: { progress_status: "심사 중" } });

    const receipt = await svc.moveRowAtomic(owner, boardId, {
      itemId: item.id, targetGroupId: group("💰 승인").id, beforeItemId: null, expectedVersion: await version(), requestId: crypto.randomUUID(),
    });

    expect(receipt.replayed).toBe(false);
    const after = await svc.getItem(owner, boardId, item.id);
    expect(after.group_id).toBe(group("💰 승인").id);
    expect(after.values.progress_status).toBe("승인");
  });

  it("값만 있는 단계(업체관리)도 다른 그룹으로 옮기면 그 그룹의 단계가 된다", async () => {
    const { svc, boardId, group, version } = await contractWorkBoard();
    const item = await svc.createItem(owner, boardId, { title: "업체관리 건", group_id: group("⏹️ 준비단계").id, values: { progress_status: "업체관리" } });

    await svc.moveRowAtomic(owner, boardId, {
      itemId: item.id, targetGroupId: group("📂 소진공 혁신성장 접수예정").id, beforeItemId: null, expectedVersion: await version(), requestId: crypto.randomUUID(),
    });

    expect((await svc.getItem(owner, boardId, item.id)).values.progress_status).toBe("📂소진공 혁신성장 대기");
  });

  it("같은 그룹 안 순서 바꾸기는 값만 있는 단계를 그대로 둔다", async () => {
    const { svc, boardId, group, version } = await contractWorkBoard();
    const approved = group("💰 승인").id;
    const first = await svc.createItem(owner, boardId, { title: "첫째", group_id: approved, values: { progress_status: "업체관리" } });
    const second = await svc.createItem(owner, boardId, { title: "둘째", group_id: approved, values: { progress_status: "승인" } });

    const receipt = await svc.moveRowAtomic(owner, boardId, {
      itemId: first.id, targetGroupId: approved, beforeItemId: null, expectedVersion: await version(), requestId: crypto.randomUUID(),
    });

    expect(receipt.version).toBe(1);
    const rows = await svc.listItems(owner, boardId);
    expect(rows.filter((row) => row.group_id === approved).map((row) => row.id)).toEqual([second.id, first.id]);
    expect(rows.find((row) => row.id === first.id)?.values.progress_status).toBe("업체관리");
  });

  it("같은 requestId 재전송은 커밋 뒤에도 같은 요청으로 재생된다(충돌 없음)", async () => {
    const { local, svc, boardId, group, version } = await contractWorkBoard();
    const item = await svc.createItem(owner, boardId, { title: "재전송 건", group_id: group("🔂 심사 중").id, values: { progress_status: "심사 중" } });
    const request = {
      itemId: item.id, targetGroupId: group("💰 승인").id, beforeItemId: null, expectedVersion: await version(), requestId: crypto.randomUUID(),
    };
    const atomic = vi.spyOn(local, "setValuesAndMoveAtomic");

    const firstReceipt = await svc.moveRowAtomic(owner, boardId, request);
    const replay = await svc.moveRowAtomic(owner, boardId, request);

    expect(replay.replayed).toBe(true);
    expect(replay.version).toBe(firstReceipt.version);
    // 두 번 모두 «값이 실린» 같은 요청이었다 — 한쪽만 값이 있으면 replay conflict 가 난다.
    expect(atomic.mock.calls.map(([, , sent]) => sent.values)).toEqual([{ progress_status: "승인" }, { progress_status: "승인" }]);
    expect(await version()).toBe(firstReceipt.version);
  });

  it("현재 값이 이미 목적 그룹을 가리키면 그 값을 지킨다", async () => {
    const { store, svc, boardId, group, version } = await contractWorkBoard();
    const managed = group("관리중").id;
    // 회사가 «소공인(상생)» 도 관리중 그룹으로 보내게 이었다 — 관리중 그룹의 대표는 여전히 «관리중».
    const status = (await store.listColumns(owner, boardId)).find((column) => column.key === "progress_status")!;
    await store.updateColumn(owner, status.id, { moveRule: { ...status.move_rule_jsonb, "소공인(상생)": managed } });
    const kept = await svc.createItem(owner, boardId, { title: "상생", group_id: group("⏹️ 준비단계").id, values: { progress_status: "소공인(상생)" } });
    const synced = await svc.createItem(owner, boardId, { title: "해당연도", group_id: group("⏹️ 준비단계").id, values: { progress_status: "해당연도 매출" } });

    await svc.moveRowAtomic(owner, boardId, { itemId: kept.id, targetGroupId: managed, beforeItemId: null, expectedVersion: await version(), requestId: crypto.randomUUID() });
    await svc.moveRowAtomic(owner, boardId, { itemId: synced.id, targetGroupId: managed, beforeItemId: null, expectedVersion: await version(), requestId: crypto.randomUUID() });

    expect((await svc.getItem(owner, boardId, kept.id)).values.progress_status).toBe("소공인(상생)");
    expect((await svc.getItem(owner, boardId, synced.id)).values.progress_status).toBe("관리중");
  });

  it("대표 단계가 없는 그룹(회사가 만든 그룹)으로 옮기면 값은 그대로다", async () => {
    const { store, svc, boardId, group, version } = await contractWorkBoard();
    const custom = await store.createGroup(owner, boardId, { name: "회사 메모 그룹", sortOrder: 30 });
    const item = await svc.createItem(owner, boardId, { title: "메모", group_id: group("🔂 심사 중").id, values: { progress_status: "심사 중" } });

    await svc.moveRowAtomic(owner, boardId, { itemId: item.id, targetGroupId: custom.id, beforeItemId: null, expectedVersion: await version(), requestId: crypto.randomUUID() });

    const after = await svc.getItem(owner, boardId, item.id);
    expect(after.group_id).toBe(custom.id);
    expect(after.values.progress_status).toBe("심사 중");
  });

  it("낡은 expectedVersion 은 값도 그룹도 바꾸지 않는다", async () => {
    const { svc, boardId, group, version } = await contractWorkBoard();
    const item = await svc.createItem(owner, boardId, { title: "낡은 버전", group_id: group("🔂 심사 중").id, values: { progress_status: "심사 중" } });

    await expect(svc.moveRowAtomic(owner, boardId, {
      itemId: item.id, targetGroupId: group("💰 승인").id, beforeItemId: null, expectedVersion: (await version()) + 5, requestId: crypto.randomUUID(),
    })).rejects.toThrow(/순서가 변경/);

    const after = await svc.getItem(owner, boardId, item.id);
    expect(after.group_id).toBe(group("🔂 심사 중").id);
    expect(after.values.progress_status).toBe("심사 중");
  });

  it("일괄 그룹 이동처럼 receipt.version 을 이어 쓰면 여러 행이 차례로 옮겨지고 단계도 맞는다", async () => {
    const { svc, boardId, group, version } = await contractWorkBoard();
    const review = group("🔂 심사 중").id;
    const a = await svc.createItem(owner, boardId, { title: "a", group_id: review, values: { progress_status: "심사 중" } });
    const b = await svc.createItem(owner, boardId, { title: "b", group_id: review, values: { progress_status: "업체관리" } });
    let expectedVersion = await version();
    for (const itemId of [a.id, b.id]) {
      const receipt = await svc.moveRowAtomic(owner, boardId, {
        itemId, targetGroupId: group("⛔ 대출불가").id, beforeItemId: null, expectedVersion, requestId: crypto.randomUUID(),
      });
      expectedVersion = receipt.version;
    }
    for (const itemId of [a.id, b.id]) {
      const after = await svc.getItem(owner, boardId, itemId);
      expect(after.group_id).toBe(group("⛔ 대출불가").id);
      expect(after.values.progress_status).toBe("불가");
    }
  });

  it("계약업체 실무가 아닌 보드는 이동 규칙이 있어도 값을 건드리지 않는다", async () => {
    const local = new LocalBoardsRepo();
    const svc = new BoardsService(toAsyncBoardsRepo(local));
    const detail = await svc.createBoard(owner, { name: "일반 보드" });
    const waiting = await svc.addGroup(owner, detail.board.id, { name: "대기" });
    const done = await svc.addGroup(owner, detail.board.id, { name: "완료" });
    const column = await svc.addColumn(owner, detail.board.id, {
      label: "상태", type: "select",
      options: [{ id: "wait", label: "대기", order: 0 }, { id: "done", label: "완료", order: 1 }],
      moveRule: { wait: waiting.id, done: done.id },
    });
    const item = await svc.createItem(owner, detail.board.id, { title: "일반", group_id: waiting.id, values: { [column.key]: "wait" } });

    await svc.moveRowAtomic(owner, detail.board.id, { itemId: item.id, targetGroupId: done.id, beforeItemId: null, expectedVersion: 0, requestId: crypto.randomUUID() });

    const after = await svc.getItem(owner, detail.board.id, item.id);
    expect(after.group_id).toBe(done.id);
    expect(after.values[column.key]).toBe("wait");
  });
});

describe("[1] 그룹을 옮기는 단계 변경의 실패를 뭉개지 않는다", () => {
  it("새로 이은 단계(관리중)를 고르면 행이 관리중 그룹으로 간다", async () => {
    const { svc, boardId, group } = await contractWorkBoard();
    const item = await svc.createItem(owner, boardId, { title: "관리 건", group_id: group("🔂 심사 중").id });

    const result = await svc.setCells(owner, boardId, item.id, { progress_status: "관리중" });

    expect(result.errors).toEqual([]);
    expect(result.item.group_id).toBe(group("관리중").id);
  });

  it("다른 사용자가 먼저 순서를 바꿔 버전이 낡으면 다시 읽고 한 번 더 시도해 저장한다", async () => {
    const { local, svc, boardId, group } = await contractWorkBoard();
    const item = await svc.createItem(owner, boardId, { title: "경합 건", group_id: group("🔂 심사 중").id });
    const other = await svc.createItem(owner, boardId, { title: "다른 행", group_id: group("🔂 심사 중").id });
    const original = local.setValuesAndMoveAtomic.bind(local);
    const sent: AtomicValueMoveRequest[] = [];
    let raced = false;
    local.setValuesAndMoveAtomic = ((ctx, id, request) => {
      sent.push(request);
      if (!raced) {
        raced = true;
        // 우리가 버전을 읽은 뒤 다른 사용자가 행을 옮겼다.
        local.moveRowAtomic(ctx, id, { itemId: other.id, targetGroupId: group("▶️ 진행중").id, beforeItemId: null, expectedVersion: 0, requestId: crypto.randomUUID() });
      }
      return original(ctx, id, request);
    }) as typeof local.setValuesAndMoveAtomic;

    const result = await svc.setCells(owner, boardId, item.id, { progress_status: "승인" }, "11111111-1111-4111-8111-111111111111");

    expect(result.errors).toEqual([]);
    expect(result.item.group_id).toBe(group("💰 승인").id);
    expect(result.item.values.progress_status).toBe("승인");
    expect(sent.map((request) => [request.requestId, request.expectedVersion])).toEqual([
      ["11111111-1111-4111-8111-111111111111", 0],
      ["11111111-1111-4111-8111-111111111111", 1],
    ]);
  });

  it("다시 시도해도 낡으면 «다른 사용자가 먼저» 로 알리고 아무것도 바꾸지 않는다", async () => {
    const { local, svc, boardId, group } = await contractWorkBoard();
    const item = await svc.createItem(owner, boardId, { title: "계속 경합", group_id: group("🔂 심사 중").id });
    const spy = vi.spyOn(local, "setValuesAndMoveAtomic").mockImplementation(() => {
      throw new Error("row move stale version");
    });

    const failure = svc.setCells(owner, boardId, item.id, { progress_status: "승인" });
    await expect(failure).rejects.toBeInstanceOf(UserFacingActionError);
    await expect(failure).rejects.toThrow(ROW_MOVE_FAILURE_MESSAGES.stale);
    expect(spy).toHaveBeenCalledTimes(2);
    const after = await svc.getItem(owner, boardId, item.id);
    expect(after.group_id).toBe(group("🔂 심사 중").id);
    expect(after.values.progress_status).toBeUndefined();
  });

  it("RPC 권한 거부·모르는 오류 — 권한은 사람 말로, 모르는 오류는 다시 시도하지 않고 그대로", async () => {
    const { local, svc, boardId, group } = await contractWorkBoard();
    const item = await svc.createItem(owner, boardId, { title: "거부 건", group_id: group("🔂 심사 중").id });
    const spy = vi.spyOn(local, "setValuesAndMoveAtomic").mockImplementationOnce(() => {
      throw new Error("row move permission denied");
    });
    await expect(svc.setCells(owner, boardId, item.id, { progress_status: "승인" })).rejects.toThrow(ROW_MOVE_FAILURE_MESSAGES.permission);

    spy.mockImplementationOnce(() => {
      throw new Error("network lost");
    });
    await expect(svc.setCells(owner, boardId, item.id, { progress_status: "승인" })).rejects.toThrow("network lost");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("행을 옮길 수 없는 담당 범위 멤버: 옮기는 단계는 사유와 함께 저장하지 않고, 값만 바뀌는 단계는 저장한다", async () => {
    const { svc, boardId, group } = await contractWorkBoard();
    const item = await svc.createItem(member, boardId, { title: "멤버 건", group_id: group("🔂 심사 중").id });

    const moving = await svc.setCells(member, boardId, item.id, { progress_status: "승인" });
    expect(moving.errors).toEqual([{ key: "progress_status", label: "진행상황", message: ROW_MOVE_FAILURE_MESSAGES.permission }]);
    expect(moving.undo).toBeNull();
    expect(moving.item.group_id).toBe(group("🔂 심사 중").id);
    expect(moving.item.values.progress_status).toBeUndefined();

    const valueOnly = await svc.setCells(member, boardId, item.id, { progress_status: "업체관리" });
    expect(valueOnly.errors).toEqual([]);
    expect(valueOnly.item.values.progress_status).toBe("업체관리");
    expect(valueOnly.item.group_id).toBe(group("🔂 심사 중").id);
  });

  it("쌍원자 저장(strict)은 멤버의 옮기는 단계를 하나도 쓰지 않는다", async () => {
    const { svc, boardId, group } = await contractWorkBoard();
    const item = await svc.createItem(member, boardId, { title: "멤버 strict", group_id: group("🔂 심사 중").id });

    const result = await svc.setCellsStrict(member, boardId, item.id, { progress_status: "승인", fee_terms: "3%" });

    expect(result.committed).toBe("none");
    expect(result.errors.map((error) => error.message)).toEqual([ROW_MOVE_FAILURE_MESSAGES.permission]);
    const after = await svc.getItem(member, boardId, item.id);
    expect(after.values.fee_terms).toBeUndefined();
  });

  it("규칙이 가리키는 그룹이 사라졌으면 값만 저장하고 그 사실을 알린다", async () => {
    const { store, svc, boardId, group } = await contractWorkBoard();
    const status = (await store.listColumns(owner, boardId)).find((column) => column.key === "progress_status")!;
    await store.updateColumn(owner, status.id, { moveRule: { ...status.move_rule_jsonb, "승인": "group-that-was-deleted" } });
    const item = await svc.createItem(owner, boardId, { title: "그룹 없음", group_id: group("🔂 심사 중").id });

    const result = await svc.setCells(owner, boardId, item.id, { progress_status: "승인" });

    expect(result.item.values.progress_status).toBe("승인");
    expect(result.item.group_id).toBe(group("🔂 심사 중").id);
    expect(result.errors).toEqual([{ key: "progress_status", label: "진행상황", message: ROW_MOVE_VALUE_ONLY_NOTICE }]);
  });

  it("RPC 가 대상 그룹 없음을 알려도(경합으로 방금 사라짐) 값만 저장한다", async () => {
    const { local, svc, boardId, group } = await contractWorkBoard();
    const item = await svc.createItem(owner, boardId, { title: "경합 삭제", group_id: group("🔂 심사 중").id });
    vi.spyOn(local, "setValuesAndMoveAtomic").mockImplementationOnce(() => {
      throw new Error("target group unavailable");
    });

    const result = await svc.setCells(owner, boardId, item.id, { progress_status: "승인" });

    expect(result.item.values.progress_status).toBe("승인");
    expect(result.item.group_id).toBe(group("🔂 심사 중").id);
    expect(result.errors.map((error) => error.message)).toEqual([ROW_MOVE_VALUE_ONLY_NOTICE]);
  });
});
