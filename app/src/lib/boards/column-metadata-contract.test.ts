import { describe, expect, it } from "vitest";
import { BOARD_COLUMN_ERROR_CODES, BOARD_COLUMN_RPC, type BoardColumnCommandArgs, type BoardColumnPolicy, type BoardColumnValidation } from "./column-metadata-contract";

describe("BBE-176 board column RPC contract", () => {
  it("freezes the exact RPC names and failure codes consumed by C", () => {
    expect(BOARD_COLUMN_RPC).toEqual({ command: "execute_board_column_command", typeDryRun: "board_column_type_dry_run" });
    expect(BOARD_COLUMN_ERROR_CODES).toEqual({ permissionDenied: "42501", notFound: "P0002", invalidOrUnsafe: "22023", staleDryRun: "40001" });
  });

  it("requires tenant, board, request id, operation, and payload", () => {
    const command = {
      p_org_id: "org",
      p_board_id: "board",
      p_column_id: null,
      p_operation: "create_at",
      p_request_id: "request",
      p_payload: { position: 2 },
    } satisfies BoardColumnCommandArgs;
    expect(command.p_operation).toBe("create_at");
  });

  it("freezes metadata allowlist shapes", () => {
    const policy = { roles: ["owner"], scopes: ["all"], userIds: ["10000000-0000-4000-8000-000000000001"] } satisfies BoardColumnPolicy;
    const validation = { minLength: 1, maxLength: 30, min: 0, max: 100, pattern: "^[A-Z]", allowedValues: ["A", 1, true] } satisfies BoardColumnValidation;
    expect(Object.keys(policy)).toEqual(["roles", "scopes", "userIds"]);
    expect(Object.keys(validation)).toEqual(["minLength", "maxLength", "min", "max", "pattern", "allowedValues"]);
  });
});
