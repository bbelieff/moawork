import type { MemberRole } from "@/lib/auth/roles";

export const BOARD_COLUMN_RPC = {
  command: "execute_board_column_command",
  typeDryRun: "board_column_type_dry_run",
} as const;

export type BoardColumnCommandOperation =
  | "create_at"
  | "duplicate"
  | "rename"
  | "settings"
  | "reorder"
  | "type_commit"
  | "archive"
  | "restore";

export type BoardColumnPolicy = {
  /** ★ 정본은 lib/auth/roles.ts. 손으로 다시 적으면 역할이 늘 때 안 따라온다 (#707). */
  roles?: MemberRole[];
  scopes?: Array<"all" | "department" | "assigned">;
  userIds?: string[];
};

export type BoardColumnValidation = {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  allowedValues?: Array<string | number | boolean>;
};

export type BoardColumnCommandArgs = {
  p_org_id: string;
  p_board_id: string;
  p_column_id: string | null;
  p_operation: BoardColumnCommandOperation;
  p_request_id: string;
  p_payload: Record<string, unknown>;
  /** Duplicate only. Omitted callers are structure-only; value copy requires explicit true. */
  p_copy_values?: boolean;
};

export type BoardColumnTypeDryRunArgs = {
  p_org_id: string;
  p_board_id: string;
  p_column_id: string;
  p_target_type: string;
};

export type BoardColumnTypeDryRun = {
  columnId: string;
  targetType: string;
  totalValues: number;
  invalidValues: number;
  safe: boolean;
  fingerprint: string;
};

export type BoardColumnCommandResult = {
  accepted: true;
  replayed: boolean;
  operation: BoardColumnCommandOperation;
  columnId: string;
  column: Record<string, unknown>;
};

export const BOARD_COLUMN_ERROR_CODES = {
  permissionDenied: "42501",
  notFound: "P0002",
  invalidOrUnsafe: "22023",
  staleDryRun: "40001",
  /**
   * 컬럼 key 중복. `board_columns` 의 `unique (board_id, key)` 는 partial 이 아니라서
   * (003_boards_engine.sql) 이미 그 key 를 쓰는 컬럼이 있으면 새로 만들 수 없다.
   */
  duplicateKey: "23505",
  /**
   * 서버가 «이름을 못 찾음». #653 에서 실제로 이것 때문에 컬럼 명령이 100% 죽었다 —
   * pgcrypto 가 extensions 에 있는데 함수의 search_path 에 그 스키마가 없었다.
   *
   * ★ 이 코드가 기본 문구로 떨어지면 안 된다. 기본 문구는 「잠시 뒤 다시 시도해 주세요」인데
   *   이건 시간이 지나도 절대 안 풀리는 «설정» 문제다. 그렇게 말하면 사용자는
   *   될 때까지 누르게 되고(총괄은 실제로 그렇게 16번 눌렀다), 아무도 원인을 모른다.
   */
  undefinedFunction: "42883",
} as const;

export type BoardColumnErrorCode =
  (typeof BOARD_COLUMN_ERROR_CODES)[keyof typeof BOARD_COLUMN_ERROR_CODES];

/**
 * 서버가 돌려준 SQLSTATE 를 사람이 읽는 한 문장으로 옮긴다.
 *
 * 코드를 그대로 노출하면 사용자가 할 수 있는 일이 없다. 특히 `23505` 는 화면에
 * 「이 이름의 컬럼이 이미 있습니다」로 보여야 한다 — 원인이 이름 충돌이라는 것을
 * 알아야 다음 행동(다른 이름 쓰기)을 고를 수 있기 때문이다.
 *
 * 아직 없는 기능을 안내하지 않는다. 복구 화면이 생기기 전까지 이 문구는
 * 「휴지통에서 되살리세요」 같은 말을 하지 않는다 — 가짜 안내는 가짜 성공이다.
 */
export function boardColumnErrorMessage(code: string | null | undefined): string {
  switch (code) {
    case BOARD_COLUMN_ERROR_CODES.permissionDenied:
      return "컬럼 구조를 바꿀 권한이 없습니다. 워크스페이스 관리자에게 요청해 주세요.";
    case BOARD_COLUMN_ERROR_CODES.notFound:
      return "보드를 찾을 수 없습니다. 화면을 새로고침해 주세요.";
    case BOARD_COLUMN_ERROR_CODES.duplicateKey:
      return "이 이름의 컬럼이 이미 있습니다. 다른 이름을 써 주세요.";
    case BOARD_COLUMN_ERROR_CODES.invalidOrUnsafe:
      return "입력값이 올바르지 않아 적용하지 못했습니다. 값을 확인해 주세요.";
    case BOARD_COLUMN_ERROR_CODES.staleDryRun:
      return "그 사이 다른 사람이 이 컬럼을 바꿨습니다. 새로고침한 뒤 다시 시도해 주세요.";
    case BOARD_COLUMN_ERROR_CODES.undefinedFunction:
      // 「다시 시도」라고 말하지 않는다 — 다시 눌러도 절대 안 된다. 눌러서 될 일이 아니라고 말한다.
      return "서버 설정 문제로 컬럼을 바꾸지 못했습니다. 다시 눌러도 같으니 관리자에게 알려 주세요.";
    default:
      return "컬럼 작업에 실패했습니다. 잠시 뒤 다시 시도해 주세요.";
  }
}
