/**
 * 2026-10-06 — 진행현황(계약업체 실무) 단계 ↔ 그룹 정합.
 *
 *   [1] 그룹을 옮기는 단계 변경이 실패할 때: 권한 사전 확인 · 낡은 버전 1회 재시도 ·
 *       옮길 그룹이 없으면 값만 저장 · 아는 실패는 사람 말로.
 *   [3] 행을 다른 그룹으로 옮기면(드래그·행별 이동·일괄 이동·키보드 = moveRowAtomic 한 경로)
 *       진행현황도 그 그룹의 대표 단계로 맞춘다 — 같은 원자 RPC, 같은 requestId 재생 의미.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoardsService, columnPolicyAllows } from "./service";
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

/** 전체 범위 팀장 — 행 이동 관문(owner/admin 또는 scope=all)은 통과하지만 관리자는 아니다. */
const teamLead = {
  org: owner.org,
  user: { id: "lead-stage", name: "Lead", email: "lead@example.test" },
  role: "team_lead",
  scope: "all",
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

describe("[3] 단계 칸의 편집·보기 제한 — 값을 못 쓰는 사람의 이동은 값 없이 그대로 성공한다", () => {
  const MANAGERS_ONLY = { roles: ["owner", "admin"] };
  type PolicyKey = "edit_policy_jsonb" | "view_policy_jsonb";

  /** 회사가 컬럼 설정에서 진행상황 칸을 «관리자만» 으로 묶었다(로컬 저장소는 컬럼 행을 그대로 돌려준다). */
  async function restrictedBoard(policyKey: PolicyKey, policy: Record<string, unknown> = MANAGERS_ONLY) {
    const board = await contractWorkBoard();
    const status = board.local.listColumns(owner, board.boardId).find((column) => column.key === "progress_status")!;
    status[policyKey] = policy;
    return board;
  }

  /** 로컬 저장소는 컬럼 제한을 강제하지 않는다 — 운영 RPC(issue602_board_cell_value_is_valid)처럼 값-이동을 거부한다. */
  function rejectValueMoves(local: LocalBoardsRepo) {
    return vi.spyOn(local, "setValuesAndMoveAtomic").mockImplementation(() => {
      throw new Error("cell value is not editable or valid");
    });
  }

  it.each<PolicyKey>(["edit_policy_jsonb", "view_policy_jsonb"])("%s=관리자만 · 전체 범위 팀장: 심사 중 → 승인 드래그는 값 없이 옮겨진다", async (policyKey) => {
    const { local, svc, boardId, group, version } = await restrictedBoard(policyKey);
    const valueMove = rejectValueMoves(local);
    const item = await svc.createItem(owner, boardId, { title: "제한 드래그", group_id: group("🔂 심사 중").id, values: { progress_status: "심사 중" } });

    const receipt = await svc.moveRowAtomic(teamLead, boardId, {
      itemId: item.id, targetGroupId: group("💰 승인").id, beforeItemId: null, expectedVersion: await version(), requestId: crypto.randomUUID(),
    });

    expect(receipt.replayed).toBe(false);
    expect(valueMove).not.toHaveBeenCalled();
    const after = await svc.getItem(owner, boardId, item.id);
    expect(after.group_id).toBe(group("💰 승인").id);
    expect(after.values.progress_status).toBe("심사 중");
  });

  it.each<PolicyKey>(["edit_policy_jsonb", "view_policy_jsonb"])("%s=관리자만 · 전체 범위 팀장: 대표 단계와 같은 행의 같은 그룹 재정렬도 성공한다", async (policyKey) => {
    const { local, svc, boardId, group, version } = await restrictedBoard(policyKey);
    const valueMove = rejectValueMoves(local);
    const approved = group("💰 승인").id;
    const first = await svc.createItem(owner, boardId, { title: "첫째", group_id: approved, values: { progress_status: "승인" } });
    const second = await svc.createItem(owner, boardId, { title: "둘째", group_id: approved, values: { progress_status: "승인" } });

    await svc.moveRowAtomic(teamLead, boardId, {
      itemId: first.id, targetGroupId: approved, beforeItemId: null, expectedVersion: await version(), requestId: crypto.randomUUID(),
    });

    expect(valueMove).not.toHaveBeenCalled();
    const rows = await svc.listItems(owner, boardId);
    expect(rows.filter((row) => row.group_id === approved).map((row) => row.id)).toEqual([second.id, first.id]);
  });

  it("편집=관리자만 · 전체 범위 팀장의 일괄 그룹 이동(receipt.version 이어 쓰기)도 값 없이 모두 옮겨진다", async () => {
    const { local, svc, boardId, group, version } = await restrictedBoard("edit_policy_jsonb");
    const valueMove = rejectValueMoves(local);
    const review = group("🔂 심사 중").id;
    const rejected = group("⛔ 대출불가").id;
    const a = await svc.createItem(owner, boardId, { title: "a", group_id: review, values: { progress_status: "심사 중" } });
    const b = await svc.createItem(owner, boardId, { title: "b", group_id: review, values: { progress_status: "업체관리" } });
    let expectedVersion = await version();
    for (const itemId of [a.id, b.id]) {
      const receipt = await svc.moveRowAtomic(teamLead, boardId, { itemId, targetGroupId: rejected, beforeItemId: null, expectedVersion, requestId: crypto.randomUUID() });
      expectedVersion = receipt.version;
    }

    expect(valueMove).not.toHaveBeenCalled();
    const rows = await svc.listItems(owner, boardId);
    expect(rows.filter((row) => row.group_id === rejected).map((row) => [row.id, row.values.progress_status])).toEqual([
      [a.id, "심사 중"],
      [b.id, "업체관리"],
    ]);
  });

  it("같은 제한이어도 제한이 열린 사람(owner)의 드래그는 단계를 맞춘다", async () => {
    const { svc, boardId, group, version } = await restrictedBoard("edit_policy_jsonb");
    const item = await svc.createItem(owner, boardId, { title: "관리자 드래그", group_id: group("🔂 심사 중").id, values: { progress_status: "심사 중" } });

    await svc.moveRowAtomic(owner, boardId, {
      itemId: item.id, targetGroupId: group("💰 승인").id, beforeItemId: null, expectedVersion: await version(), requestId: crypto.randomUUID(),
    });

    expect((await svc.getItem(owner, boardId, item.id)).values.progress_status).toBe("승인");
  });

  it("제한이 팀장에게도 열려 있으면(scopes=all) 팀장의 드래그도 단계를 맞춘다", async () => {
    const { svc, boardId, group, version } = await restrictedBoard("edit_policy_jsonb", { scopes: ["all"] });
    const item = await svc.createItem(owner, boardId, { title: "범위 허용", group_id: group("🔂 심사 중").id, values: { progress_status: "심사 중" } });

    await svc.moveRowAtomic(teamLead, boardId, {
      itemId: item.id, targetGroupId: group("💰 승인").id, beforeItemId: null, expectedVersion: await version(), requestId: crypto.randomUUID(),
    });

    expect((await svc.getItem(owner, boardId, item.id)).values.progress_status).toBe("승인");
  });
});

describe("columnPolicyAllows — DB board_column_policy_allows(089) 와 같은 규칙", () => {
  it.each<[string, Record<string, unknown> | null | undefined, boolean]>([
    ["정책 없음", undefined, true],
    ["null", null, true],
    ["빈 객체", {}, true],
    ["관리자만", { roles: ["owner", "admin"] }, false],
    ["팀장 포함", { roles: ["team_lead"] }, true],
    ["전체 범위", { scopes: ["all"] }, true],
    ["담당 범위만", { scopes: ["assigned"] }, false],
    ["이 사용자", { userIds: ["lead-stage"] }, true],
    ["다른 사용자", { userIds: ["someone-else"] }, false],
    ["모든 키가 맞아야 한다", { roles: ["team_lead"], scopes: ["department"] }, false],
    ["배열이 아니면 닫힌다", { roles: "team_lead" }, false],
  ])("%s", (_name, policy, expected) => {
    expect(columnPolicyAllows(teamLead, policy)).toBe(expected);
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
    const { store, svc, boardId, group } = await contractWorkBoard();
    // #845 이후 기본 14단계는 모두 그룹을 옮긴다. «값만 바뀌는 단계» 는 회사가 규칙을 뗀 단계로 만든다.
    const status = (await store.listColumns(owner, boardId)).find((column) => column.key === "progress_status")!;
    const valueOnlyRule = { ...status.move_rule_jsonb };
    delete valueOnlyRule["업체관리"];
    await store.updateColumn(owner, status.id, { moveRule: valueOnlyRule });
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
    // 검토 P3 — 저장은 성공했다. 알림은 errors 가 아니라 notices 로만 온다(호출부가 성공을 실패로 읽지 않게).
    expect(result.errors).toEqual([]);
    expect(result.notices).toEqual([{ key: "progress_status", label: "진행상황", message: ROW_MOVE_VALUE_ONLY_NOTICE }]);
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
    expect(result.errors).toEqual([]);
    expect(result.notices.map((notice) => notice.message)).toEqual([ROW_MOVE_VALUE_ONLY_NOTICE]);
  });

  it("쌍원자 저장(strict)도 «값만 저장» 을 실패가 아니라 committed=all + notices 로 돌려준다", async () => {
    const { store, svc, boardId, group } = await contractWorkBoard();
    const status = (await store.listColumns(owner, boardId)).find((column) => column.key === "progress_status")!;
    await store.updateColumn(owner, status.id, { moveRule: { ...status.move_rule_jsonb, "승인": "group-that-was-deleted" } });
    const item = await svc.createItem(owner, boardId, { title: "strict 알림", group_id: group("🔂 심사 중").id });

    const result = await svc.setCellsStrict(owner, boardId, item.id, { progress_status: "승인" });

    expect(result.committed).toBe("all");
    expect(result.errors).toEqual([]);
    expect(result.commitDetail).toBeNull();
    expect(result.notices.map((notice) => notice.message)).toEqual([ROW_MOVE_VALUE_ONLY_NOTICE]);
    expect(result.item.values.progress_status).toBe("승인");
  });
});

describe("검토 P2 — 켜진 발송 규칙이 있으면 드래그는 단계를 쓰지 않는다", () => {
  it("progress_status 에 켜진 messaging_trigger_rules 가 있으면 값 없이 위치만 옮긴다", async () => {
    const { local, svc, boardId, group, version } = await contractWorkBoard();
    const rules = vi.spyOn(local, "hasEnabledMessagingTriggerRules").mockReturnValue(true);
    const valueMove = vi.spyOn(local, "setValuesAndMoveAtomic");
    const item = await svc.createItem(owner, boardId, { title: "발송 규칙", group_id: group("🔂 심사 중").id, values: { progress_status: "심사 중" } });

    await svc.moveRowAtomic(owner, boardId, {
      itemId: item.id, targetGroupId: group("💰 승인").id, beforeItemId: null, expectedVersion: await version(), requestId: crypto.randomUUID(),
    });

    expect(rules).toHaveBeenCalledWith(owner, boardId, "progress_status");
    expect(valueMove).not.toHaveBeenCalled();
    const after = await svc.getItem(owner, boardId, item.id);
    expect(after.group_id).toBe(group("💰 승인").id);
    expect(after.values.progress_status).toBe("심사 중");
  });

  it("발송 규칙을 읽지 못하면(RLS·네트워크) 보내질 수 있다고 보고 값 없이 옮긴다", async () => {
    const { local, svc, boardId, group, version } = await contractWorkBoard();
    vi.spyOn(local, "hasEnabledMessagingTriggerRules").mockImplementation(() => {
      throw new Error("permission denied for table messaging_trigger_rules");
    });
    const valueMove = vi.spyOn(local, "setValuesAndMoveAtomic");
    const item = await svc.createItem(owner, boardId, { title: "읽기 실패", group_id: group("🔂 심사 중").id, values: { progress_status: "심사 중" } });

    await svc.moveRowAtomic(owner, boardId, {
      itemId: item.id, targetGroupId: group("💰 승인").id, beforeItemId: null, expectedVersion: await version(), requestId: crypto.randomUUID(),
    });

    expect(valueMove).not.toHaveBeenCalled();
    const after = await svc.getItem(owner, boardId, item.id);
    expect(after.group_id).toBe(group("💰 승인").id);
    expect(after.values.progress_status).toBe("심사 중");
  });

  it("발송 규칙을 확인할 수 없는 저장소(메서드 없음)도 값을 쓰지 않는다", async () => {
    const { local, boardId, group, version } = await contractWorkBoard();
    const store = toAsyncBoardsRepo(local);
    const withoutRules = new Proxy(store, {
      get: (target, property) => (property === "hasEnabledMessagingTriggerRules" ? undefined : Reflect.get(target, property)),
    });
    const svc = new BoardsService(withoutRules);
    const valueMove = vi.spyOn(local, "setValuesAndMoveAtomic");
    const item = await svc.createItem(owner, boardId, { title: "메서드 없음", group_id: group("🔂 심사 중").id, values: { progress_status: "심사 중" } });

    await svc.moveRowAtomic(owner, boardId, {
      itemId: item.id, targetGroupId: group("💰 승인").id, beforeItemId: null, expectedVersion: await version(), requestId: crypto.randomUUID(),
    });

    expect(valueMove).not.toHaveBeenCalled();
    expect((await svc.getItem(owner, boardId, item.id)).values.progress_status).toBe("심사 중");
  });

  it("켜진 규칙이 없으면(대조군) 드래그가 단계를 맞춘다", async () => {
    const { local, svc, boardId, group, version } = await contractWorkBoard();
    const rules = vi.spyOn(local, "hasEnabledMessagingTriggerRules");
    const item = await svc.createItem(owner, boardId, { title: "규칙 없음", group_id: group("🔂 심사 중").id, values: { progress_status: "심사 중" } });

    await svc.moveRowAtomic(owner, boardId, {
      itemId: item.id, targetGroupId: group("💰 승인").id, beforeItemId: null, expectedVersion: await version(), requestId: crypto.randomUUID(),
    });

    expect(rules).toHaveBeenCalled();
    expect((await svc.getItem(owner, boardId, item.id)).values.progress_status).toBe("승인");
  });
});
