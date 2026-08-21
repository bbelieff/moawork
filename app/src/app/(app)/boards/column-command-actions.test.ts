import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./column-command-actions.ts", import.meta.url), "utf8");

describe("BBE-177 command boundary", () => {
  it("checks permission and board membership before every hosted mutation", () => {
    expect(source.indexOf('loadPermGuard(ctx.org.id, "structure.column_manage")')).toBeLessThan(source.indexOf("rpc.rpc(BOARD_COLUMN_RPC.command"));
    expect(source.indexOf("service.getBoardDetail(ctx, boardId)")).toBeLessThan(source.indexOf("rpc.rpc(BOARD_COLUMN_RPC.command"));
    expect(source).toContain("p_org_id: ctx.org.id");
    expect(source).toContain("p_board_id: boardId");
  });

  it("uses 115 explicit copy boundary and type dry-run fingerprint", () => {
    expect(source).toContain('p_copy_values: data.get("copyValues") === "true"');
    expect(source).toContain("BOARD_COLUMN_RPC.typeDryRun");
    expect(source).toContain("if (!dryRun.safe)");
    expect(source).toContain("fingerprint: dryRun.fingerprint");
  });

  it("keeps errors visible and archive recoverable", () => {
    expect(source).toContain("boardColumnErrorMessage");
    expect(source).toContain('operation === "archive"');
    expect(source).toContain("archivedColumnId");
    expect(source).toContain('operation === "restore"');
    expect(source).toContain('if (operation !== "archive") revalidatePath');
  });
});
