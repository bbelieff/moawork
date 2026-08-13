import { beforeEach, describe, expect, it } from "vitest";
import { getRepo } from "@/lib/repo";
import { resetDb } from "@/lib/repo/local/store";
import { SEED_ORG_ID, SEED_USER_OWNER } from "@/lib/repo/local/seed";
import { BoardsService } from "@/lib/boards";
import type { Ctx } from "@/lib/types";
import { SEOUL_STRUCTURE_PACK } from "@/lib/migration/monday-mapping";
import {
  assigneeGroupDisplayName,
  assigneeGroupIdForUser,
  installStructurePack as installPack,
  type AssigneeMember,
} from "./install";
import type { PackBoard, StructurePack } from "./types";

const installStructurePack = (
  ctx: Ctx,
  options: Omit<Parameters<typeof installPack>[1], "pack"> & { pack?: StructurePack } = {},
) => installPack(ctx, { ...options, pack: options.pack ?? SEOUL_STRUCTURE_PACK });

function owner(): Ctx {
  return {
    user: { id: SEED_USER_OWNER, email: "t@demo", name: "t", avatar_url: null, created_at: "" },
    org: { id: SEED_ORG_ID, name: "demo", plan_tier: "t1_3", created_at: "" },
    role: "owner",
    scope: "all",
  } as Ctx;
}

const boards = () => new BoardsService();

/** 시드 조직 멤버를 install.ts 와 같은 규칙(가입순)으로 정렬 — 테스트 기대값 계산용. */
function seedAssignees(): AssigneeMember[] {
  return getRepo()
    .listMembers(SEED_ORG_ID)
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((m) => ({ userId: m.user_id, displayName: m.user?.name ?? m.user_id }));
}

/** install.ts 의 `resolveSectionName` 과 같은 규칙 — 담당자별 슬롯이 채워졌으면 이름을 붙인다. */
function expectedGroupNames(packBoard: PackBoard, assignees: AssigneeMember[]): string[] {
  return packBoard.sections
    .map((s) =>
      s.assigneeSlot === undefined
        ? s.groupName
        : assignees[s.assigneeSlot]
          ? `${s.groupName}${assignees[s.assigneeSlot].displayName}`
          : null,
    )
    .filter((name): name is string => name !== null);
}

beforeEach(async () => {
  resetDb();
});

describe("새 조직 설치 — acceptance (PLAN-002/WO-1)", () => {
  it("3개 보드가 팩 순서대로 생성된다", async () => {
    const result = await installStructurePack(owner());
    expect(result.boards.map((b) => b.slug)).toEqual(["newcust", "contact", "work"]);

    const installed = await boards().listBoards(owner());
    for (const packBoard of SEOUL_STRUCTURE_PACK.boards) {
      const found = installed.find((b) => b.name === packBoard.name);
      expect(found, `${packBoard.name} 생성됨`).toBeDefined();
      expect(found?.icon).toBe(packBoard.icon);
      expect(found?.source).toBe(`${SEOUL_STRUCTURE_PACK.key}/${packBoard.slug}`);
    }
  });

  it("그룹이 이름·색·순서까지 팩 그대로 생성된다 — 담당자별 그룹은 멤버 이름이 채워진다", async () => {
    const result = await installStructurePack(owner());
    const assignees = seedAssignees();

    for (const [index, packBoard] of SEOUL_STRUCTURE_PACK.boards.entries()) {
      const detail = await boards().getBoardDetail(owner(), result.boards[index].boardId);
      const ordered = [...detail.groups].sort((a, b) => a.sort_order - b.sort_order);

      expect(ordered.map((g) => assigneeGroupDisplayName(g.name)), `${packBoard.slug} 그룹 이름·순서`).toEqual(
        expectedGroupNames(packBoard, assignees),
      );
      const expectedColors = packBoard.sections
        .filter((s) => s.assigneeSlot === undefined || assignees[s.assigneeSlot])
        .map((s) => s.color);
      expect(ordered.map((g) => g.color), `${packBoard.slug} 그룹 색`).toEqual(expectedColors);
    }
  });

  it("D73 — 담당자별 그룹 이름에 시드 멤버 표시 이름이 그대로 붙는다", async () => {
    const result = await installStructurePack(owner());
    const assignees = seedAssignees();
    expect(assignees.length, "시드 조직 멤버 수").toBeGreaterThanOrEqual(2);

    const newcust = await boards().getBoardDetail(owner(), result.boards[0].boardId);
    const names = newcust.groups.map((g) => assigneeGroupDisplayName(g.name));
    expect(names).toContain(`♻️${assignees[0].displayName}`);
    expect(names).toContain(`♻️${assignees[1].displayName}`);
  });

  it("D73 — 담당자가 슬롯 수보다 적으면 그 슬롯의 그룹은 만들지 않는다(1명 → 1개)", async () => {
    const oneMember: AssigneeMember[] = [{ userId: SEED_USER_OWNER, displayName: "만든사람" }];
    const result = await installStructurePack(owner(), { assignees: oneMember });

    for (const [index, packBoard] of SEOUL_STRUCTURE_PACK.boards.entries()) {
      const detail = await boards().getBoardDetail(owner(), result.boards[index].boardId);
      const definedSlots = packBoard.sections.filter((s) => s.assigneeSlot !== undefined);
      // 슬롯이 2개(원래 담당자 2명) 정의돼 있어도 멤버가 1명뿐이면 그룹은 1개만 생겨야 한다.
      const createdSlotGroups = detail.groups.filter((g) =>
        definedSlots.some(
          (s) => assigneeGroupDisplayName(g.name) === `${s.groupName}만든사람`,
        ),
      );
      expect(createdSlotGroups, `${packBoard.slug} 담당자별 그룹 수(멤버 1명)`).toHaveLength(
        definedSlots.length === 0 ? 0 : 1,
      );
    }
  });

  it("컬럼이 key·라벨·타입·순서까지 팩 그대로 생성된다", async () => {
    const result = await installStructurePack(owner());

    for (const [index, packBoard] of SEOUL_STRUCTURE_PACK.boards.entries()) {
      const detail = await boards().getBoardDetail(owner(), result.boards[index].boardId);
      const ordered = [...detail.columns].sort((a, b) => a.sort_order - b.sort_order);

      expect(ordered.map((c) => c.key), `${packBoard.slug} 컬럼 순서`).toEqual(
        packBoard.columns.map((c) => c.key),
      );
      expect(ordered.map((c) => c.label)).toEqual(packBoard.columns.map((c) => c.label));
      expect(ordered.map((c) => c.type)).toEqual(packBoard.columns.map((c) => c.type));
    }
  });

  it("상태 라벨의 hex 색이 선택지에 그대로 실린다", async () => {
    const result = await installStructurePack(owner());
    const detail = await boards().getBoardDetail(owner(), result.boards[0].boardId);

    const 상담상황 = detail.columns.find((c) => c.key === "status");
    const options = 상담상황?.options_jsonb?.options;
    expect(options).toHaveLength(16);
    expect(options?.[0]).toMatchObject({
      id: "2차 상담예약",
      label: "2차 상담예약",
      color: "#9d50dd",
    });
    expect(options?.at(-1)).toMatchObject({ label: "상담 전", color: "#c4c4c4" });
  });

  it("저장 뷰가 생성된다 — 업무관리 테이블 뷰 7종", async () => {
    const result = await installStructurePack(owner());
    const workBoardId = result.boards[2].boardId;

    const views = await boards().listViews(owner(), workBoardId);
    expect(views.map((v) => v.name)).toEqual(
      SEOUL_STRUCTURE_PACK.boards[2].views.map((v) => v.name),
    );
    expect(views).toHaveLength(7);
  });

  it("Name 칸은 업체명이다 — 시드 확정 ①", async () => {
    const result = await installStructurePack(owner());
    expect(result.boards.map((b) => b.nameLabel)).toEqual(["업체명", "업체명", "업체명"]);

    // Name 은 items.title 이라 컬럼 행으로 만들지 않는다 — 없는 컬럼을 만들지 않았음을 확인.
    for (const board of result.boards) {
      const labels = (await boards().getBoardDetail(owner(), board.boardId)).columns.map((c) => c.label);
      expect(labels).not.toContain("업체명");
      expect(labels).not.toContain("회사명");
    }
  });

  it("공용 선택지 세트가 실제로 심긴다 — 지역 222지·사업자유형 6종 (시드 확정 ②)", async () => {
    const result = await installStructurePack(owner());

    for (const [index, key] of [
      [1, "dropdown_mkyfat98"],
      [2, "dropdown_mky78058"],
    ] as const) {
      const detail = await boards().getBoardDetail(owner(), result.boards[index].boardId);
      const 지역 = detail.columns.find((c) => c.key === key);
      const options = 지역?.options_jsonb?.options;
      expect(options, `${key} 지역 선택지`).toHaveLength(222);
      expect(options?.[0]).toMatchObject({ id: "서울_강남구", label: "서울_강남구" });
      expect(options?.at(-1)).toMatchObject({ label: "경남_합천군" });
    }

    const contact = await boards().getBoardDetail(owner(), result.boards[1].boardId);
    const 사업자유형 = contact.columns.find((c) => c.key === "dropdown_mkyfg5he");
    expect(사업자유형?.options_jsonb?.options).toHaveLength(6);
  });

  it("아이템(행) 데이터는 만들지 않는다 — 구조만 복제한다", async () => {
    const result = await installStructurePack(owner());
    for (const board of result.boards) {
      expect((await boards().listItems(owner(), board.boardId))).toHaveLength(0);
    }
  });
});

describe("유예 컬럼은 설치되지 않는다", () => {
  it("수식·타임라인·하위아이템은 보드에 만들어지지 않고 목록으로만 돌아온다", async () => {
    const result = await installStructurePack(owner());

    // 업무관리: 하위 태스크 + 타임라인 + 수식 4 = 6
    const workDeferred = result.deferred.filter((d) => d.boardSlug === "work");
    expect(workDeferred).toHaveLength(6);

    const detail = await boards().getBoardDetail(owner(), result.boards[2].boardId);
    const installedKeys = new Set(detail.columns.map((c) => c.key));
    for (const column of workDeferred) {
      expect(installedKeys.has(column.key), `${column.label} 미설치`).toBe(false);
    }
  });

  it("팩 전체 유예 컬럼은 9종이다", async () => {
    expect((await installStructurePack(owner())).deferred).toHaveLength(9);
  });
});

describe("재설치 안전성", () => {
  it("D73 — 최초 1명, 초대 증가, 내보내기 감소, 재실행 중복 0을 userId 바인딩으로 맞춘다", async () => {
    const creator: AssigneeMember = { userId: "user-creator", displayName: "만든사람" };
    const invited: AssigneeMember = { userId: "user-invited", displayName: "초대된사람" };
    const first = await installStructurePack(owner(), { assignees: [creator] });
    const installedBoardIds = first.boards.map((board) => board.boardId);

    expect(first.assigneeGroups).toHaveLength(2);
    expect(new Set(first.assigneeGroups.map((binding) => binding.userId))).toEqual(
      new Set([creator.userId]),
    );

    const afterInvite = await installStructurePack(owner(), {
      assignees: [creator, invited],
    });
    expect(afterInvite.boards).toHaveLength(0);
    expect(afterInvite.skipped).toEqual(["newcust", "contact", "work"]);
    expect(afterInvite.assigneeGroups).toHaveLength(4);
    expect(new Set(afterInvite.assigneeGroups.map((binding) => binding.userId))).toEqual(
      new Set([creator.userId, invited.userId]),
    );
    expect(assigneeGroupIdForUser(afterInvite.assigneeGroups, "newcust", invited.userId)).toBeTruthy();
    expect(assigneeGroupIdForUser(afterInvite.assigneeGroups, "newcust", "same-display-name")).toBeNull();

    const invitedGroupId = assigneeGroupIdForUser(afterInvite.assigneeGroups, "newcust", invited.userId);
    if (!invitedGroupId) throw new Error("초대 멤버 그룹 없음");
    const creatorGroupId = assigneeGroupIdForUser(afterInvite.assigneeGroups, "newcust", creator.userId);
    if (!creatorGroupId) throw new Error("최초 멤버 그룹 없음");
    const newcustBoardId = first.boards.find((board) => board.slug === "newcust")?.boardId;
    if (!newcustBoardId) throw new Error("신규업체 보드 없음");
    const preservedItem = await boards().createItem(owner(), newcustBoardId, {
      title: "보존할 업체",
      group_id: invitedGroupId,
      values: { text_mm40jz80: "보존할 광고" },
    });
    const removedOwnerItem = await boards().createItem(owner(), newcustBoardId, {
      title: "내보낸 담당자의 업체",
      group_id: creatorGroupId,
      values: { text_mm40jz80: "일반 그룹으로 보존" },
    });

    const groupCountAfterInvite = await Promise.all(installedBoardIds.map(
      async (boardId) => (await boards().getBoardDetail(owner(), boardId)).groups.length,
    ));
    const rerun = await installStructurePack(owner(), {
      assignees: [creator, invited],
    });
    expect(rerun.assigneeGroups.map((binding) => binding.groupId).sort()).toEqual(
      afterInvite.assigneeGroups.map((binding) => binding.groupId).sort(),
    );
    expect(
      await Promise.all(installedBoardIds.map(async (boardId) => (await boards().getBoardDetail(owner(), boardId)).groups.length)),
    ).toEqual(groupCountAfterInvite);

    const afterRemoval = await installStructurePack(owner(), {
      assignees: [invited],
    });
    expect(afterRemoval.assigneeGroups).toHaveLength(2);
    expect(new Set(afterRemoval.assigneeGroups.map((binding) => binding.userId))).toEqual(
      new Set([invited.userId]),
    );
    expect(
      await Promise.all(installedBoardIds.map(async (boardId) => (await boards().getBoardDetail(owner(), boardId)).groups.length)),
    ).toEqual(groupCountAfterInvite.map((count, index) => (index < 2 ? count - 1 : count)));
    for (const binding of afterRemoval.assigneeGroups) {
      expect(
        (await boards().getBoardDetail(owner(), binding.boardId))
          .groups.some((group) => group.id === binding.groupId),
      ).toBe(true);
    }
    const migratedItem = await boards().getItem(owner(), newcustBoardId, preservedItem.id);
    const remainingGroupId = assigneeGroupIdForUser(
      afterRemoval.assigneeGroups,
      "newcust",
      invited.userId,
    );
    expect(remainingGroupId).toBeTruthy();
    expect(migratedItem.group_id).not.toBeNull();
    expect(migratedItem.group_id).toBe(remainingGroupId);
    expect(migratedItem.title).toBe("보존할 업체");
    expect(migratedItem.values.text_mm40jz80).toBe("보존할 광고");
    const fallbackItem = await boards().getItem(owner(), newcustBoardId, removedOwnerItem.id);
    expect(fallbackItem.group_id).not.toBeNull();
    expect(fallbackItem.group_id).not.toBe(creatorGroupId);
    expect(fallbackItem.group_id).not.toBe(remainingGroupId);
    expect(fallbackItem.title).toBe("내보낸 담당자의 업체");
    expect(fallbackItem.values.text_mm40jz80).toBe("일반 그룹으로 보존");
  });

  it("두 번 설치해도 보드가 두 벌 생기지 않는다", async () => {
    await installStructurePack(owner());
    const before = (await boards().listBoards(owner())).length;

    const second = await installStructurePack(owner());
    expect(second.boards).toHaveLength(0);
    expect(second.skipped).toEqual(["newcust", "contact", "work"]);
    expect((await boards().listBoards(owner()))).toHaveLength(before);
  });

  it("일부만 있는 상태에서는 나머지만 채운다", async () => {
    const first = await installStructurePack(owner(), {
      pack: { ...SEOUL_STRUCTURE_PACK, boards: [SEOUL_STRUCTURE_PACK.boards[0]] },
    });
    expect(first.boards).toHaveLength(1);

    const second = await installStructurePack(owner());
    expect(second.skipped).toEqual(["newcust"]);
    expect(second.boards.map((b) => b.slug)).toEqual(["contact", "work"]);
  });
});
