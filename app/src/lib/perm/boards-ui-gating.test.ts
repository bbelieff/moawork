import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const app = join(__dirname, "..", "..", "app", "(app)", "boards");

describe("boards UI consumes effective permissions", () => {
  it("gates board creation and preset installation", () => {
    const source = readFileSync(join(app, "page.tsx"), "utf8");
    expect(source).toContain('loadPermGuard(ctx.org.id, "structure.tab_manage")');
    expect(source).toContain('loadPermGuard(ctx.org.id, "structure.preset_edit")');
    expect(source).toContain("canManageTabs && <li><NewBoardInline />");
  });

  it("gates item, structure, and destructive controls on a board", () => {
    const source = readFileSync(join(app, "[id]", "page.tsx"), "utf8");
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
