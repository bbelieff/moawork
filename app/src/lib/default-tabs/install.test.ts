/**
 * 기본 탭 보장 — 실제로 포트를 통해 심기는가 (BBE-145).
 *
 * 정의가 맞는지는 `new-lead.test.ts` 가 목업과 대조한다. 여기서는 그 정의가
 * **BoardsRepo 를 거쳐 실제 보드·그룹·컬럼·이동규칙이 되는지**를 본다.
 * 특히 이동 규칙의 «그룹 이름 → group id» 해석은 여기서만 검증된다.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { LocalBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import { resolveMoveTarget } from "@/lib/boards/moveRules";
import type { Ctx } from "@/lib/types";
import { NEW_LEAD_GROUPS, NEW_LEAD_TAB } from "./new-lead";
import { ensureDefaultTab, ensureDefaultTabs } from "./install";

const ctx: Ctx = {
  org: { id: "org-default-tabs", name: "테스트 회사" },
  user: { id: "user-owner", name: "만든 사람", email: "owner@example.com" },
  role: "owner",
  scope: "all",
} as unknown as Ctx;

let repo: LocalBoardsRepo;

beforeEach(() => {
  resetDb();
  repo = new LocalBoardsRepo();
});

describe("기본 탭 보장 (D76 — «설치» 단계 없이)", () => {
  it("신규리드 보드·그룹 5·컬럼 22 가 실제로 만들어진다", async () => {
    const [result] = await ensureDefaultTabs(ctx, repo);

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
    const first = await ensureDefaultTab(ctx, NEW_LEAD_TAB, repo);
    const second = await ensureDefaultTab(ctx, NEW_LEAD_TAB, repo);

    expect(second.created).toBe(false);
    expect(second.boardId).toBe(first.boardId);
    expect(repo.listBoards(ctx).filter((board) => board.name === NEW_LEAD_TAB.name)).toHaveLength(1);
    expect(repo.listColumns(ctx, first.boardId)).toHaveLength(22);
  });

  it("컬럼 순서가 정의 순서 그대로 심긴다 — 목업 순서가 화면 순서다", async () => {
    const [result] = await ensureDefaultTabs(ctx, repo);
    expect(repo.listColumns(ctx, result.boardId).map((column) => column.key)).toEqual(
      NEW_LEAD_TAB.columns.map((column) => column.key),
    );
  });

  it("맨 오른쪽 고정 열은 «컨택 이동» 하나뿐이다", async () => {
    const [result] = await ensureDefaultTabs(ctx, repo);
    const pinned = repo.listColumns(ctx, result.boardId).filter((column) => column.rightPinned);
    expect(pinned.map((column) => column.label)).toEqual(["컨택 이동"]);
  });

  it("출처(source)가 컬럼마다 심긴다 — 편집 가능 여부의 근거다", async () => {
    const [result] = await ensureDefaultTabs(ctx, repo);
    const byKey = new Map(repo.listColumns(ctx, result.boardId).map((column) => [column.key, column]));
    for (const column of NEW_LEAD_TAB.columns) {
      expect(byKey.get(column.key)?.source, column.label).toBe(column.source);
    }
  });

  it("✉ 발송 3칸은 잠긴 채로 심긴다 — 안전장치 전까지 돈이 나가면 안 된다", async () => {
    const [result] = await ensureDefaultTabs(ctx, repo);
    const send = repo.listColumns(ctx, result.boardId).filter((column) => column.source === "msg");
    expect(send).toHaveLength(3);
    for (const column of send) expect(column.is_readonly, column.label).toBe(true);
  });
});

describe("자동 이동 — 값을 바꾸면 카드가 그 그룹으로 간다 (6규칙)", () => {
  it("이동 규칙이 실재하는 group id 를 가리킨다", async () => {
    const [result] = await ensureDefaultTabs(ctx, repo);
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
    const [result] = await ensureDefaultTabs(ctx, repo);
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
    const [result] = await ensureDefaultTabs(ctx, repo);
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
    const [result] = await ensureDefaultTabs(ctx, repo);
    const move = repo
      .listColumns(ctx, result.boardId)
      .find((column) => column.key === "contact_move")!;
    expect(move.move_rule_jsonb).toBeNull();
  });
});
