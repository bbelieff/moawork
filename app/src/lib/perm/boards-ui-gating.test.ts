import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const app = join(__dirname, "..", "..", "app", "(app)", "boards");

describe("boards UI consumes effective permissions", () => {
  it("gates board creation and excludes the customer Monday pack", () => {
    const source = readFileSync(join(app, "page.tsx"), "utf8");
    expect(source).toContain('loadPermGuard(ctx.org.id, "work.view_tabs")');
    expect(source.indexOf('loadPermGuard(ctx.org.id, "work.view_tabs")')).toBeLessThan(
      source.indexOf("listBoards(ctx)"),
    );
    expect(source).toContain('if (viewPermission.kind !== "allowed") notFound()');
    expect(source).toContain('loadPermGuard(ctx.org.id, "structure.tab_manage")');
    expect(source).toContain("canManageTabs && <li><NewBoardInline />");
    expect(source).not.toContain("POLICYFUND_STRUCTURE_PACK");
    expect(source).not.toContain("InstallPackButton");
  });

  it("gates item, structure, and destructive controls on a board", () => {
    const source = readFileSync(join(app, "[id]", "page.tsx"), "utf8");
    expect(source).toContain("loadPermGuards(ctx.org.id, [");
    expect(source).toContain("loadPermissionScopedWorkItems(ctx.org.id)");
    expect(source).toMatch(
      /await\s+Promise\.all\s*\(\s*\[[\s\S]*loadPermGuards\([\s\S]*loadPermissionScopedWorkItems\(/u,
    );
    expect(source).toContain('if (viewTabs.kind !== "allowed") notFound()');
    expect(source.indexOf('if (viewTabs.kind !== "allowed") notFound()')).toBeLessThan(
      source.indexOf("svc.loadPageSnapshot(ctx, id, {"),
    );
    expect(source).toContain("if (!scopedItems.ok) notFound()");
    expect(source.indexOf("if (!scopedItems.ok) notFound()")).toBeLessThan(
      source.indexOf("svc.loadPageSnapshot(ctx, id, {"),
    );
    // 보관함도 같은 관문 뒤 같은 물결에서 읽는다 (휴지통과 같은 등급).
    expect(source).toContain("includeDeleted: canDeleteItems,");
    expect(source).toContain("includeArchived: canDeleteItems,");
    expect(source).toContain("visibleItemIds.has(item.id)");
    expect(source).toContain("const permissionItems = boardItems.filter");
    expect(source).toContain("const hiddenCount = boardItems.length - permissionItems.length");
    expect(source).toContain("권한 밖 {hiddenCount}건 숨김");
    for (const key of [
      "work.item_upsert",
      "work.item_delete",
      "structure.column_manage",
      "structure.section_manage",
      "danger.bulk_edit_delete",
    ]) expect(source).toContain(`"${key}"`);
    expect(source).not.toContain("loadPermGuard(ctx.org.id");
    expect(source).toContain("canEditItems={canEditItems}");
    expect(source).toContain("canDeleteItems={canDeleteItems}");
    expect(source).toContain("canManageColumns={canManageColumns}");
    expect(source).toContain("canManageSections={canManageSections}");
    expect(source).toContain('const canMoveRows = !board.is_system && canEditItems');
    expect(source).toContain('ctx.role === "owner" || ctx.role === "admin" || ctx.scope === "all"');
    expect(source).toContain("canMoveRows={canMoveRows}");
    expect(source).toContain("isSystem={board.is_system}");
    // #845 (2026-10-08) — 「⚙ 보드 설정」 펼침·업무 양식·그룹 순서 칸이 빠지고 머리말 「탭 설정」 대화상자가 된다.
    //   칸마다 그 칸의 권한 뒤에서만 그린다: 일반 = 탭 관리, 항목 = 컬럼 관리, 단계 = 그룹 관리. 시스템 보드는 없다.
    expect(source).not.toContain('id="board-settings"');
    expect(source).not.toContain("<GroupPresetMenu");
    expect(source).toContain("const settingsSections: TabSettingsSection[] = board.is_system ? [] : [");
    expect(source).toContain('...(canManageSummaries ? ["general" as const] : [])');
    expect(source).toContain('...(canManageColumns ? ["fields" as const] : [])');
    expect(source).toContain('...(canManageSections ? ["stages" as const] : [])');
    expect(source).toContain("general={canManageSummaries ? (");
    expect(source).toContain("fields={canManageColumns ? (");
    expect(source).toContain("stages={canManageSections ? (");
    expect(source).toContain("tabSettingsSections={settingsSections}");
    // #849 탭 삭제(휴지통) 확인은 여전히 danger 권한 뒤에서만, 시스템 보드가 아닐 때만 그린다.
    expect(source).toContain("const tabTrashDialog = !board.is_system && canDeleteBoard ? (");
    expect(source).toContain("deleteAction={deleteBoardAction}");
    expect(source).toContain("tabTrashSlot={tabTrashDialog}");
    const trashDialog = readFileSync(
      join(__dirname, "..", "..", "components", "board", "TabTrashDialog.tsx"),
      "utf8",
    );
    expect(trashDialog).toContain("<form action={deleteAction}");
    const table = readFileSync(join(__dirname, "..", "..", "components", "board", "GroupTable.tsx"), "utf8");
    // #845 5단계 — 칸 이름이 곧 칸 메뉴다. 「칸 자체 바꾸기」(이름·입력 방식·옮기기·지우기)와 폭 조절은
    // 칸 관리 권한 + 구조를 바꿀 수 있는 칸에서만, 보는 방법(나만)만 권한과 무관하다. 서버도 다시 검사한다.
    expect(table).toContain("const manageStructure = canManageColumns && !structureLocked;");
    expect(table).toContain("canManage={manageStructure}");
    expect(table).toContain("{manageStructure && (");
    expect(table).toContain("<ColumnContextMenu");
    const columnMenu = readFileSync(join(__dirname, "..", "..", "components", "board", "ColumnContextMenu.tsx"), "utf8");
    expect(columnMenu).toContain("{canManage ? (");
    expect(columnMenu).toContain("<BoardInlineTitleEditor");
    expect(table).not.toContain("⠿");
    // BBE-239 — 공지사항 작성자 예외로 canDeleteRow 가 됐지만, role 권한(canDeleteItems)은
    // 여전히 그 계산식 안에 있어야 한다(작성자 예외가 role 권한을 대체하면 안 된다).
    // #845 (2026-10-08) — 업체명 칸의 「삭제」 단추가 빠지고 행 우클릭 메뉴·상세 ⋯ 메뉴로 옮겼다.
    // 두 진입점 모두 같은 canDeleteRow 로만 「휴지통으로 이동」 을 보인다.
    expect(table).toContain("canDeleteItems ||");
    expect(table).toContain("openRowMenuFromEvent(event, row, canDeleteRow)");
    expect(table).toContain("canTrash={canDeleteRow}");
    const rowMenu = readFileSync(join(__dirname, "..", "..", "components", "board", "RowContextMenu.tsx"), "utf8");
    expect(rowMenu).toContain("{request.canTrash ? (");
    const detailPanel = readFileSync(join(__dirname, "..", "..", "components", "board", "ItemDetailPanel.tsx"), "utf8");
    expect(detailPanel).toContain("canTrash = false,");
    expect(detailPanel).toContain("{canTrash ? (");
  });
});
