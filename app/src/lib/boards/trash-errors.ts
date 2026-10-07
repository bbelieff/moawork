/**
 * #849 탭 휴지통 오류 — 169 RPC 의 raise 이름을 사람 말로 바꾼다.
 *
 * 화면에 그대로 보여 줘도 되는 문장이라 UserFacingActionError 를 잇는다(boardActionFlash 가
 * 통과시킨다). 원래 이름은 `code` 에 남겨 호출부가 종류로 가를 수 있게 한다.
 */

import { UserFacingActionError } from "./boardActionFlash";

export type BoardTrashErrorCode =
  | "permission_denied"
  | "board_unavailable"
  | "system_board"
  | "board_not_in_trash"
  | "default_tab_dismissed"
  | "default_tab_already_installed";

const MESSAGES: Readonly<Record<BoardTrashErrorCode, string>> = {
  permission_denied: "이 탭 작업을 할 권한이 없어요. 대표에게 권한을 요청해 주세요.",
  board_unavailable: "탭을 찾을 수 없어요. 새로고침 후 다시 확인해 주세요.",
  system_board: "시스템 탭은 지울 수 없어요.",
  board_not_in_trash: "휴지통에 있는 탭만 완전히 지울 수 있어요. 새로고침 후 다시 확인해 주세요.",
  default_tab_dismissed: "지운 기본 탭이에요. 휴지통에서 되살리거나 «기본 탭 다시 설치»로 새로 만들어 주세요.",
  default_tab_already_installed: "같은 기본 탭이 이미 있어 되살릴 수 없어요. 지금 있는 탭을 먼저 휴지통으로 보낸 뒤 다시 시도해 주세요.",
};

export class BoardTrashError extends UserFacingActionError {
  constructor(readonly code: BoardTrashErrorCode, message = MESSAGES[code]) {
    super(message);
    this.name = "BoardTrashError";
  }
}

/** 지운 기본 탭을 다시 만들려 했다 — 휴지통 복구나 «기본 탭 다시 설치»로 가야 한다. */
export class DefaultTabDismissedError extends BoardTrashError {
  constructor() {
    super("default_tab_dismissed");
    this.name = "DefaultTabDismissedError";
  }
}

/** 되살리려는 기본 탭이 이미 다시 설치돼 있다. */
export class DefaultTabAlreadyInstalledError extends BoardTrashError {
  constructor() {
    super("default_tab_already_installed");
    this.name = "DefaultTabAlreadyInstalledError";
  }
}

const CODES = Object.keys(MESSAGES) as BoardTrashErrorCode[];

/** Supabase RPC 오류 → 휴지통 오류. 모르는 오류는 지금처럼 원문 Error 로 둔다. */
export function toBoardTrashError(error: { message?: string; code?: string } | null | undefined): Error {
  const message = error?.message ?? "";
  const code = CODES.find((candidate) => message === candidate || message.includes(candidate));
  if (code === "default_tab_dismissed") return new DefaultTabDismissedError();
  if (code === "default_tab_already_installed") return new DefaultTabAlreadyInstalledError();
  if (code) return new BoardTrashError(code);
  return new Error(message || "Supabase boards query failed");
}
