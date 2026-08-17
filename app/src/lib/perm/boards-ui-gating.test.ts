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
    expect(source).toContain('loadPermGuard(ctx.org.id, "work.view_tabs")');
    expect(source).toContain("loadPermissionScopedWorkItems(ctx.org.id)");
    expect(source).toContain('if (viewTabs.kind !== "allowed") notFound()');
    expect(source.indexOf('if (viewTabs.kind !== "allowed") notFound()')).toBeLessThan(
      source.indexOf("loadPermissionScopedWorkItems(ctx.org.id)"),
    );
    expect(source).toContain("if (!scopedItems.ok) notFound()");
    expect(source.indexOf("if (!scopedItems.ok) notFound()")).toBeLessThan(
      source.indexOf("svc.getBoardDetail(ctx, id)"),
    );
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
    ]) expect(source).toContain(`loadPermGuard(ctx.org.id, "${key}")`);
    expect(source).toContain("canEditItems={canEditItems}");
    expect(source).toContain("canDeleteItems={canDeleteItems}");
    expect(source).toContain("canManageColumns={canManageColumns}");
    expect(source).toContain("canDeleteBoard && <form action={deleteBoardAction}");
    const table = readFileSync(join(__dirname, "..", "..", "components", "board", "GroupTable.tsx"), "utf8");
    expect(table).toContain("{canManageColumns && <span");
    expect(table).toContain("{canDeleteItems && (");
  });
});
