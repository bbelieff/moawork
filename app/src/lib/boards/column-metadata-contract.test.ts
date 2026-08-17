import { describe, expect, it } from "vitest";
import { BOARD_COLUMN_ERROR_CODES, BOARD_COLUMN_RPC, boardColumnErrorMessage, type BoardColumnCommandArgs, type BoardColumnPolicy, type BoardColumnValidation } from "./column-metadata-contract";

describe("BBE-176 board column RPC contract", () => {
  it("freezes the exact RPC names and failure codes consumed by C", () => {
    expect(BOARD_COLUMN_RPC).toEqual({ command: "execute_board_column_command", typeDryRun: "board_column_type_dry_run" });
    expect(BOARD_COLUMN_ERROR_CODES).toEqual({ permissionDenied: "42501", notFound: "P0002", invalidOrUnsafe: "22023", staleDryRun: "40001", duplicateKey: "23505" });
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

/**
 * BBE-177 — 오류 코드를 사람 말로 옮기는 층.
 *
 * 무엇을 깨뜨리면 빨개지는가: 문구를 지우거나 코드 분기를 빼면 1·2번이,
 * 아직 없는 복구 기능을 안내하기 시작하면 3번이 실패한다.
 */
describe("BBE-177 컬럼 오류 문구", () => {
  it("키 중복은 원인을 이름 충돌로 지목한다", () => {
    expect(boardColumnErrorMessage(BOARD_COLUMN_ERROR_CODES.duplicateKey)).toBe(
      "이 이름의 컬럼이 이미 있습니다. 다른 이름을 써 주세요.",
    );
  });

  it("모르는 코드도 빈 문자열로 두지 않는다", () => {
    for (const code of [null, undefined, "99999"]) {
      expect(boardColumnErrorMessage(code).length).toBeGreaterThan(0);
    }
  });

  it("복구 화면이 없는 동안에는 되살리기를 안내하지 않는다", () => {
    const all = Object.values(BOARD_COLUMN_ERROR_CODES).map(boardColumnErrorMessage);
    for (const message of [...all, boardColumnErrorMessage("99999")]) {
      expect(message).not.toMatch(/휴지통|되살리|복구/u);
    }
  });
});
