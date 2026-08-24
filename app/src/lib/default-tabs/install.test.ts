/**
 * 기본 탭 보장 — 실제로 포트를 통해 심기는가 (BBE-145).
 *
 * 정의가 맞는지는 `new-lead.test.ts` 가 목업과 대조한다. 여기서는 그 정의가
 * **BoardsRepo 를 거쳐 실제 보드·그룹·컬럼·이동규칙이 되는지**를 본다.
 * 특히 이동 규칙의 «그룹 이름 → group id» 해석은 여기서만 검증된다.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import { db } from "@/lib/repo/local/store";
import { getRepo } from "@/lib/repo";
import { resolveMoveTarget } from "@/lib/boards/moveRules";
import type { Ctx } from "@/lib/types";
import type { BoardsRepo, NewColumn } from "@/lib/boards/store";
import { CONTACT_GROUPS, CONTACT_TAB } from "./contact";
import { NEW_LEAD_GROUPS, NEW_LEAD_TAB } from "./new-lead";
import { ensureDefaultTab, ensureDefaultTabAdditive, ensureDefaultTabs } from "./install";

const ctx: Ctx = {
  org: { id: "org-default-tabs", name: "테스트 회사" },
  user: { id: "member-account-a", name: "계정 A", email: "a@example.test" },
  role: "owner",
  scope: "all",
} as unknown as Ctx;

const assignees = [
  { userId: "member-account-a", displayName: "계정 A" },
  { userId: "member-account-b", displayName: "계정 B" },
  { userId: "member-account-c", displayName: "계정 C" },
] as const;

let repo: LocalBoardsRepo;

function memoizedColumnReads(store: LocalBoardsRepo): BoardsRepo {
  const asyncStore = toAsyncBoardsRepo(store);
  const snapshots = new Map<string, Awaited<ReturnType<BoardsRepo["listColumns"]>>>();
  const occupied = new Map<string, Set<number>>();
  return new Proxy(asyncStore, {
    get(target, property, receiver) {
      if (property === "listColumns") {
        return async (_ctx: Ctx, boardId: string) => {
          if (!snapshots.has(boardId)) snapshots.set(boardId, await target.listColumns(_ctx, boardId));
          return structuredClone(snapshots.get(boardId)!);
        };
      }
      if (property === "createColumn") {
        return async (_ctx: Ctx, boardId: string, input: NewColumn) => {
          const frozen = snapshots.get(boardId) ?? await target.listColumns(_ctx, boardId);
          const sortOrder = input.sortOrder ?? frozen.length;
          const positions = occupied.get(boardId) ?? new Set(frozen.map((column) => column.sort_order));
          if (positions.has(sortOrder)) throw new Error("board_columns_active_order_idx");
          positions.add(sortOrder);
          occupied.set(boardId, positions);
          return target.createColumn(_ctx, boardId, { ...input, sortOrder });
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

beforeEach(() => {
  resetDb();
  assignees.forEach((assignee, index) => {
    getRepo().addMember(ctx.org.id, {
      id: assignee.userId,
      name: assignee.displayName,
      email: `${assignee.userId}@example.test`,
      avatar_url: null,
      created_at: `2026-08-14T00:00:0${index}Z`,
    }, index === 0 ? "owner" : "member", "all");
  });
  db().members
    .filter((member) => member.org_id === ctx.org.id)
    .forEach((member, index) => { member.created_at = `2026-08-14T00:00:0${index}Z`; });
  repo = new LocalBoardsRepo();
});

it("repairs a partially-created product board on request replay", async () => {
  const partial = repo.createBoard(ctx, {
    name: NEW_LEAD_TAB.name,
    description: NEW_LEAD_TAB.description,
    icon: NEW_LEAD_TAB.icon,
    source: NEW_LEAD_TAB.source,
  });
  repo.createGroup(ctx, partial.id, {
    name: NEW_LEAD_TAB.groups[0].name,
    color: NEW_LEAD_TAB.groups[0].color,
  });
  repo.createColumn(ctx, partial.id, {
    key: NEW_LEAD_TAB.columns[0].key,
    label: NEW_LEAD_TAB.columns[0].label,
    type: NEW_LEAD_TAB.columns[0].type,
    source: NEW_LEAD_TAB.columns[0].source,
  });

  const result = await ensureDefaultTab(ctx, NEW_LEAD_TAB, toAsyncBoardsRepo(repo), assignees);
  expect(result.created).toBe(false);
  expect(repo.listGroups(ctx, partial.id)).toHaveLength(NEW_LEAD_TAB.groups.length);
  expect(repo.listColumns(ctx, partial.id)).toHaveLength(NEW_LEAD_TAB.columns.length);
  expect(new Set(repo.listColumns(ctx, partial.id).map((column) => column.key)).size)
    .toBe(NEW_LEAD_TAB.columns.length);
});

describe("BBE-184 additive existing-workspace repair", () => {
  it("completes every missing column in one request even when GET is memoized", async () => {
    const result = await ensureDefaultTabAdditive(ctx, NEW_LEAD_TAB, memoizedColumnReads(repo), assignees);
    const columns = repo.listColumns(ctx, result.boardId);

    expect(columns).toHaveLength(NEW_LEAD_TAB.columns.length);
    expect(new Set(columns.map((column) => column.sort_order)).size).toBe(columns.length);
    expect(columns.map((column) => column.sort_order)).toEqual(
      NEW_LEAD_TAB.columns.map((_, index) => index),
    );
  });

  it("continues after the maximum durable position instead of a gapped row count", async () => {
    const partial = repo.createBoard(ctx, { name: NEW_LEAD_TAB.name, source: NEW_LEAD_TAB.source });
    repo.createColumn(ctx, partial.id, {
      key: NEW_LEAD_TAB.columns[0].key,
      label: NEW_LEAD_TAB.columns[0].label,
      type: NEW_LEAD_TAB.columns[0].type,
      sortOrder: 7,
    });

    await ensureDefaultTabAdditive(ctx, NEW_LEAD_TAB, memoizedColumnReads(repo), assignees);
    const columns = repo.listColumns(ctx, partial.id);

    expect(columns).toHaveLength(NEW_LEAD_TAB.columns.length);
    expect(columns[0].sort_order).toBe(7);
    expect(columns.slice(1).map((column) => column.sort_order)).toEqual(
      NEW_LEAD_TAB.columns.slice(1).map((_, index) => index + 8),
    );
  });

  it("fills only missing structure and preserves every existing row and value", async () => {
    const partial = repo.createBoard(ctx, {
      name: NEW_LEAD_TAB.name,
      source: NEW_LEAD_TAB.source,
    });
    const existingGroup = repo.createGroup(ctx, partial.id, {
      name: NEW_LEAD_TAB.groups[0].name,
      color: NEW_LEAD_TAB.groups[0].color,
    });
    repo.createColumn(ctx, partial.id, {
      key: NEW_LEAD_TAB.columns[0].key,
      label: "기존 고객 라벨",
      type: NEW_LEAD_TAB.columns[0].type,
      source: NEW_LEAD_TAB.columns[0].source,
    });
    const item = repo.createItem(ctx, partial.id, {
      title: "기존 신규리드",
      group_id: existingGroup.id,
      values: { [NEW_LEAD_TAB.columns[0].key]: "기존 값" },
    });
    const other = repo.createBoard(ctx, { name: "다른 보드", source: "user.board/other" });
    repo.createItem(ctx, other.id, { title: "다른 보드 행" });
    const beforeItems = structuredClone(db().boardItems);
    const beforeValues = structuredClone(db().itemValues);
    const beforeOther = structuredClone(repo.getBoard(ctx, other.id));

    const first = await ensureDefaultTabAdditive(ctx, NEW_LEAD_TAB, toAsyncBoardsRepo(repo), assignees);
    const second = await ensureDefaultTabAdditive(ctx, NEW_LEAD_TAB, toAsyncBoardsRepo(repo), assignees);

    expect(first.created).toBe(false);
    expect(second).toMatchObject({ created: false, boardId: partial.id });
    expect(repo.listGroups(ctx, partial.id)).toHaveLength(NEW_LEAD_TAB.groups.length);
    expect(repo.listColumns(ctx, partial.id)).toHaveLength(NEW_LEAD_TAB.columns.length);
    expect(repo.listColumns(ctx, partial.id).some((column) => column.key === "industry")).toBe(true);
    expect(repo.listColumns(ctx, partial.id).find((column) => column.key === NEW_LEAD_TAB.columns[0].key)?.label)
      .toBe("기존 고객 라벨");
    expect(repo.getItem(ctx, item.id)?.group_id).toBe(existingGroup.id);
    expect(db().boardItems).toEqual(beforeItems);
    expect(db().itemValues).toEqual(beforeValues);
    expect(repo.getBoard(ctx, other.id)).toEqual(beforeOther);
  });

  it("creates one canonical board and replays without duplicate groups or columns", async () => {
    const first = await ensureDefaultTabAdditive(ctx, NEW_LEAD_TAB, toAsyncBoardsRepo(repo), assignees);
    const firstGroups = repo.listGroups(ctx, first.boardId).map((group) => group.id);
    const firstColumns = repo.listColumns(ctx, first.boardId).map((column) => column.id);
    const second = await ensureDefaultTabAdditive(ctx, NEW_LEAD_TAB, toAsyncBoardsRepo(repo), assignees);

    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false, boardId: first.boardId });
    expect(repo.listBoards(ctx).filter((board) => board.source === NEW_LEAD_TAB.source)).toHaveLength(1);
    expect(repo.listGroups(ctx, first.boardId).map((group) => group.id)).toEqual(firstGroups);
    expect(repo.listColumns(ctx, first.boardId).map((column) => column.id)).toEqual(firstColumns);
  });
});

describe("리드컨택 기본 탭 설치", () => {
  it("그룹 7·컬럼 21·우측 고정 업무이동을 실제 보드로 만든다", async () => {
    const result = await ensureDefaultTab(ctx, CONTACT_TAB, toAsyncBoardsRepo(repo));
    expect(repo.listGroups(ctx, result.boardId)).toHaveLength(7);
    expect(repo.listColumns(ctx, result.boardId)).toHaveLength(21);
    expect(repo.listColumns(ctx, result.boardId).filter((column) => column.rightPinned).map((column) => column.label)).toEqual(["업무이동"]);
  });

  it("담당자 그룹 이름과 이동 값은 멤버 계정에서 해석하며 4규칙을 만든다", async () => {
    const result = await ensureDefaultTab(ctx, CONTACT_TAB, toAsyncBoardsRepo(repo));
    const groups = repo.listGroups(ctx, result.boardId);
    const owner = repo.listColumns(ctx, result.boardId).find((column) => column.key === "owner")!;
    const targetNames = Object.fromEntries(
      Object.entries(owner.move_rule_jsonb ?? {}).map(([value, groupId]) => [
        value,
        groups.find((group) => group.id === groupId)?.name,
      ]),
    );
    expect(Object.keys(targetNames)).toEqual(["미배정", ...assignees.map((member) => member.userId)]);
    expect(targetNames["미배정"]).toBe(CONTACT_GROUPS.unassigned);
    expect(targetNames[assignees[0].userId]).toContain(assignees[0].displayName);
    expect(targetNames[assignees[1].userId]).toContain(assignees[1].displayName);
    expect(targetNames[assignees[2].userId]).toContain(assignees[1].displayName);
  });

  it("연결 7컬럼은 provenance를 보존하면서 DB와 화면 모두 편집 가능하게 심긴다", async () => {
    const result = await ensureDefaultTab(ctx, CONTACT_TAB, toAsyncBoardsRepo(repo));
    const linked = repo.listColumns(ctx, result.boardId).filter((column) => column.source === "lk");
    expect(linked).toHaveLength(7);
    for (const column of linked) expect(column.is_readonly, column.label).toBe(false);
  });

  it("업무이동에는 그룹 이동 규칙을 심지 않는다 — BBE-152 관문 실행 미포함", async () => {
    const result = await ensureDefaultTab(ctx, CONTACT_TAB, toAsyncBoardsRepo(repo));
    const transition = repo.listColumns(ctx, result.boardId).find((column) => column.key === "work_move")!;
    expect(transition.move_rule_jsonb).toBeNull();
  });

  it("담당자 컬럼 선택지는 실제 조직 멤버 계정에서 만든다", async () => {
    const result = await ensureDefaultTab(ctx, CONTACT_TAB, toAsyncBoardsRepo(repo));
    const owner = repo.listColumns(ctx, result.boardId).find((column) => column.key === "owner")!;
    expect(owner.options_jsonb?.options.map((option) => [option.id, option.label])).toEqual(
      assignees.map((member) => [member.userId, member.displayName]),
    );
  });

  it("healthy 담당자 컬럼 replay는 동일 options와 이동 규칙을 다시 쓰지 않는다", async () => {
    const first = await ensureDefaultTab(ctx, CONTACT_TAB, toAsyncBoardsRepo(repo), assignees);
    const originalUpdate = repo.updateColumn.bind(repo);
    let updates = 0;
    repo.updateColumn = (...args) => {
      updates += 1;
      return originalUpdate(...args);
    };

    const second = await ensureDefaultTab(ctx, CONTACT_TAB, toAsyncBoardsRepo(repo), assignees);

    expect(second).toMatchObject({ created: false, boardId: first.boardId });
    expect(updates).toBe(0);
  });

  it("기존 보드에 멤버를 초대하면 담당자 그룹·선택지·이동 규칙을 동기화한다", async () => {
    db().members = db().members.filter(
      (member) => member.org_id !== ctx.org.id || member.user_id === assignees[0].userId,
    );
    const first = await ensureDefaultTab(ctx, CONTACT_TAB, toAsyncBoardsRepo(repo));
    expect(repo.listGroups(ctx, first.boardId)).toHaveLength(6);

    getRepo().addMember(ctx.org.id, {
      id: assignees[1].userId,
      name: assignees[1].displayName,
      email: "member-b@example.test",
      avatar_url: null,
      created_at: "2026-08-14T00:00:01Z",
    }, "member", "all");
    const second = await ensureDefaultTab(ctx, CONTACT_TAB, toAsyncBoardsRepo(repo));
    const owner = repo.listColumns(ctx, second.boardId).find((column) => column.key === "owner")!;
    expect(second.created).toBe(false);
    expect(repo.listGroups(ctx, second.boardId)).toHaveLength(7);
    expect(owner.options_jsonb?.options.map((option) => option.id)).toEqual([
      assignees[0].userId,
      assignees[1].userId,
    ]);
    expect(Object.keys(owner.move_rule_jsonb ?? {})).toEqual([
      "미배정",
      assignees[0].userId,
      assignees[1].userId,
    ]);
  });

  it("멤버 제거 시 담당자 그룹은 줄고 기존 아이템은 미배정 그룹에 보존한다", async () => {
    const first = await ensureDefaultTab(ctx, CONTACT_TAB, toAsyncBoardsRepo(repo));
    const owner = repo.listColumns(ctx, first.boardId).find((column) => column.key === "owner")!;
    const removedGroupId = owner.move_rule_jsonb?.[assignees[1].userId];
    const item = repo.createItem(ctx, first.boardId, {
      title: "제거 멤버의 기존 리드",
      group_id: removedGroupId,
    });
    db().members = db().members.filter(
      (member) => member.org_id !== ctx.org.id || member.user_id === assignees[0].userId,
    );

    await ensureDefaultTab(ctx, CONTACT_TAB, toAsyncBoardsRepo(repo));
    const groups = repo.listGroups(ctx, first.boardId);
    const refreshedOwner = repo.listColumns(ctx, first.boardId).find((column) => column.key === "owner")!;
    expect(groups).toHaveLength(6);
    expect(groups.some((group) => group.id === removedGroupId)).toBe(false);
    expect(repo.getItem(ctx, item.id)?.group_id).toBe(
      groups.find((group) => group.name === CONTACT_GROUPS.unassigned)?.id,
    );
    expect(refreshedOwner.options_jsonb?.options.map((option) => option.id)).toEqual([
      assignees[0].userId,
    ]);
  });
});

describe("기본 탭 보장 (D76 — «설치» 단계 없이)", () => {
  it("신규리드 보드·그룹 5·컬럼 22 가 실제로 만들어진다", async () => {
    const [result] = await ensureDefaultTabs(ctx, toAsyncBoardsRepo(repo));

    expect(result.created).toBe(true);
    const board = repo.getBoard(ctx, result.boardId);
    expect(board?.name).toBe("신규리드 관리");
    expect(repo.listGroups(ctx, result.boardId).map((group) => group.name)).toEqual(
      NEW_LEAD_TAB.groups.map((group) => group.name),
    );
    expect(repo.listColumns(ctx, result.boardId).map((column) => column.label)).toEqual(
      NEW_LEAD_TAB.columns.map((column) => column.label),
    );
  });

  it("두 번 불러도 두 벌 생기지 않는다 — 멱등", async () => {
    const first = await ensureDefaultTab(ctx, NEW_LEAD_TAB, toAsyncBoardsRepo(repo));
    const second = await ensureDefaultTab(ctx, NEW_LEAD_TAB, toAsyncBoardsRepo(repo));

    expect(second.created).toBe(false);
    expect(second.boardId).toBe(first.boardId);
    expect(repo.listBoards(ctx).filter((board) => board.name === NEW_LEAD_TAB.name)).toHaveLength(1);
    expect(repo.listColumns(ctx, first.boardId)).toHaveLength(22);
  });

  it("컬럼 순서가 정의 순서 그대로 심긴다 — 목업 순서가 화면 순서다", async () => {
    const [result] = await ensureDefaultTabs(ctx, toAsyncBoardsRepo(repo));
    expect(repo.listColumns(ctx, result.boardId).map((column) => column.key)).toEqual(
      NEW_LEAD_TAB.columns.map((column) => column.key),
    );
  });

  it("맨 오른쪽 고정 열은 «컨택 이동» 하나뿐이다", async () => {
    const [result] = await ensureDefaultTabs(ctx, toAsyncBoardsRepo(repo));
    const pinned = repo.listColumns(ctx, result.boardId).filter((column) => column.rightPinned);
    expect(pinned.map((column) => column.label)).toEqual(["컨택 이동"]);
  });

  it("출처(source)가 컬럼마다 심긴다 — 편집 가능 여부의 근거다", async () => {
    const [result] = await ensureDefaultTabs(ctx, toAsyncBoardsRepo(repo));
    const byKey = new Map(repo.listColumns(ctx, result.boardId).map((column) => [column.key, column]));
    for (const column of NEW_LEAD_TAB.columns) {
      expect(byKey.get(column.key)?.source, column.label).toBe(column.source);
    }
  });

  it("✉ 발송 3칸은 잠긴 채로 심긴다 — 안전장치 전까지 돈이 나가면 안 된다", async () => {
    const [result] = await ensureDefaultTabs(ctx, toAsyncBoardsRepo(repo));
    const send = repo.listColumns(ctx, result.boardId).filter((column) => column.source === "msg");
    expect(send).toHaveLength(3);
    for (const column of send) expect(column.is_readonly, column.label).toBe(true);
  });
});

describe("자동 이동 — 값을 바꾸면 카드가 그 그룹으로 간다 (6규칙)", () => {
  it("이동 규칙이 실재하는 group id 를 가리킨다", async () => {
    const [result] = await ensureDefaultTabs(ctx, toAsyncBoardsRepo(repo));
    const groupIds = new Set(repo.listGroups(ctx, result.boardId).map((group) => group.id));
    const consult = repo
      .listColumns(ctx, result.boardId)
      .find((column) => column.key === "consult_status")!;

    expect(consult.move_rule_jsonb).not.toBeNull();
    const targets = Object.values(consult.move_rule_jsonb!);
    expect(targets).toHaveLength(6);
    for (const target of targets) expect(groupIds.has(target)).toBe(true);
  });

  it("6규칙 전부가 목업이 지정한 그룹으로 해석된다", async () => {
    const [result] = await ensureDefaultTabs(ctx, toAsyncBoardsRepo(repo));
    const groupName = new Map(
      repo.listGroups(ctx, result.boardId).map((group) => [group.id, group.name]),
    );
    const consult = repo
      .listColumns(ctx, result.boardId)
      .find((column) => column.key === "consult_status")!;

    const resolved = Object.fromEntries(
      Object.entries(consult.move_rule_jsonb!).map(([value, id]) => [value, groupName.get(id)]),
    );
    expect(resolved).toEqual({
      "상담 전": NEW_LEAD_GROUPS.fresh,
      "1차 부재": NEW_LEAD_GROUPS.absent1,
      "2차 상담예약": NEW_LEAD_GROUPS.consult2,
      "2차 상담완료": NEW_LEAD_GROUPS.consult2,
      보류: NEW_LEAD_GROUPS.hold,
      거절: NEW_LEAD_GROUPS.rejected,
    });
  });

  it("보드 엔진의 이동 해석기가 이 규칙을 실제로 읽는다 — 규칙이 죽어 있지 않다", async () => {
    const [result] = await ensureDefaultTabs(ctx, toAsyncBoardsRepo(repo));
    const groupName = new Map(
      repo.listGroups(ctx, result.boardId).map((group) => [group.id, group.name]),
    );
    const consult = repo
      .listColumns(ctx, result.boardId)
      .find((column) => column.key === "consult_status")!;

    // 서비스가 셀 저장 때 부르는 바로 그 함수(@/lib/boards/moveRules)로 확인한다.
    expect(groupName.get(resolveMoveTarget(consult, "거절")!)).toBe(NEW_LEAD_GROUPS.rejected);
    expect(groupName.get(resolveMoveTarget(consult, "상담 전")!)).toBe(NEW_LEAD_GROUPS.fresh);
    // 규칙에 없는 값은 이동을 유발하지 않는다.
    expect(resolveMoveTarget(consult, "없는 값")).toBeNull();
  });

  it("«컨택 이동» 에는 그룹 이동 규칙이 없다 — 그 열의 일은 탭 넘김이다", async () => {
    const [result] = await ensureDefaultTabs(ctx, toAsyncBoardsRepo(repo));
    const move = repo
      .listColumns(ctx, result.boardId)
      .find((column) => column.key === "contact_move")!;
    expect(move.move_rule_jsonb).toBeNull();
  });
});
