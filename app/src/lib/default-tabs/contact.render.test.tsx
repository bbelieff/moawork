/** 리드컨택 기본 탭을 실제 공용 보드 표·서비스로 관통하는 화면 검증 — BBE-149. */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { GroupTable } from "@/components/board/GroupTable";
import { BoardsService } from "@/lib/boards/service";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import { LocalBoardsRepo, toAsyncBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { resetDb } from "@/lib/repo/local/store";
import type { Ctx } from "@/lib/types";
import { CONTACT_TAB } from "./contact";
import { ensureDefaultTab } from "./install";

const ctx = {
  org: { id: "org-contact-render", name: "테스트 회사" },
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
let asyncRepo: ReturnType<typeof toAsyncBoardsRepo>;
let boardId: string;

beforeEach(async () => {
  resetDb();
  repo = new LocalBoardsRepo();
  asyncRepo = toAsyncBoardsRepo(repo);
  boardId = (await ensureDefaultTab(ctx, CONTACT_TAB, asyncRepo, { assignees })).boardId;
});

function emptyRow(): ItemWithValues {
  return {
    id: "contact-row",
    org_id: ctx.org.id,
    board_id: boardId,
    group_id: null,
    title: "예시 회사",
    assigned_to: null,
    sort_order: 0,
    created_at: "2026-08-14T00:00:00Z",
    updated_at: "2026-08-14T00:00:00Z",
    values: {},
  };
}

function renderTab(columns: BoardColumn[]) {
  return renderToStaticMarkup(
    <GroupTable
      boardId={boardId}
      groupId={null}
      columns={columns}
      rows={[emptyRow()]}
      readOnly={false}
      rowDragEnabled={false}
      cellFlash={null}
      onColumnDrop={() => {}}
      dragRowId={null}
      canDropRow={() => false}
      onRowDragStart={() => {}}
      onRowDragEnd={() => {}}
      onRowDrop={() => {}}
    />,
  );
}

describe("리드컨택 공용 보드 화면", () => {
  it("21컬럼과 우측 sticky 업무이동을 실제 표가 렌더한다", () => {
    const columns = repo.listColumns(ctx, boardId);
    const html = renderTab(columns);
    expect(columns).toHaveLength(21);
    for (const column of CONTACT_TAB.columns) expect(html, column.label).toContain(`>${column.label}<`);
    expect(html).toContain("sticky right-0");
  });

  it("연결(lk) 칸은 편집 폼이 없고 직접입력 칸은 있다", () => {
    const html = renderTab(repo.listColumns(ctx, boardId));
    for (const key of ["ad_name", "applied_on", "phone", "industry", "rep_name", "revenue", "email"]) {
      expect(html, key).not.toContain(`name="columnKey" value="${key}"`);
    }
    expect(html).toContain('name="columnKey" value="recontact_on"');
  });

  it("미팅확정 메세지는 일반 칸이 아니라 msg 출처의 공용 확인 경로로 렌더한다", () => {
    const html = renderTab(repo.listColumns(ctx, boardId));
    expect(html).toContain('name="columnKey" value="meeting_confirm_message"');
    expect(html).toContain("✉");
  });
});

describe("담당자 기준 실제 그룹 이동", () => {
  it.each([
    ["member-account-a", "계정 A"],
    ["member-account-b", "계정 B"],
    ["member-account-c", "계정 B"],
  ])("담당자 %s를 저장하면 해당 멤버 그룹으로 이동한다", async (userId, expectedGroupMember) => {
    const item = repo.createItem(ctx, boardId, { title: "예시 회사" });
    await new BoardsService(asyncRepo).setCells(ctx, boardId, item.id, { owner: userId });
    const moved = repo.getItem(ctx, item.id)!;
    const group = repo.listGroups(ctx, boardId).find((candidate) => candidate.id === moved.group_id);
    expect(group?.name).toContain(expectedGroupMember);
    expect((await new BoardsService(asyncRepo).getItem(ctx, boardId, item.id))?.values.owner).toBe(userId);
  });
});
