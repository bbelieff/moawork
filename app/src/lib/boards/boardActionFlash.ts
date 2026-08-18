// 보드 «행 단위가 아닌» 액션 실패의 1회성 전달(flash) — 순수 인코딩 계층 (BBE-201).
//
// 왜 필요한가:
//   `addItemAction` 같은 서버 액션이 던지면 Next 오류 경계가 **화면을 통째로 덮는다**
//   ("This page couldn't load"). 사용자는 무엇이 왜 안 됐는지 모르고, 입력하던 것도 잃는다.
//   실패해야 하는 경우(권한 없음 등)까지 전부 같은 흰 화면이 되는 것이 BBE-201 의 본체다.
//
// 왜 새 쿠키인가:
//   `cellFlash` 는 **itemId 가 있어야** 하는 «셀» 오류 전달이다. 항목을 «만들다» 실패하면
//   가리킬 itemId 자체가 없다. 그래서 보드 단위로 전달한다. 설계 근거(쿠키를 쓰는 이유,
//   URL 쿼리를 쓰지 않는 이유, 짧은 TTL 로 스스로 소멸시키는 이유)는 `cellFlash.ts` 와 같다 —
//   그 파일 머리 주석이 정본이다.
//
// ★ 여기에 담는 문장은 «사용자에게 보여줄 말» 이다. 원본 예외 메시지를 그대로 넣지 마라 —
//   DB 오류 문구에는 내부 구조가 섞인다. 분류해서 사람 말로 바꾼 뒤 담는다.

import { ValidationError } from "./validation";

/**
 * 사용자에게 «그대로 보여줘도 되는» 문장을 담은 오류 (BBE-201).
 *
 * 이 표시가 없으면 호출부는 「이 메시지를 화면에 띄워도 안전한가」를 알 수 없어
 * 전부 일반 문구로 뭉개거나, 반대로 DB 원문을 그대로 노출하게 된다.
 *
 * ★ 여기(순수 모듈)에 둔다. 서버 액션 파일(`"use server"`)은 **모든 export 가
 *   async 함수여야** 하므로 클래스를 export 하면 `next build` 가 깨진다.
 *   `tsc`·vitest 는 그 규칙을 모른다 — 빌드에서만 드러난다.
 */
export class UserFacingActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingActionError";
  }
}

/**
 * 실패를 «화면에 쓸 문장» 으로 바꾼다 (BBE-201).
 *
 * ★ 원본 예외 메시지를 그대로 쓰지 않는다. DB 오류 문구에는 테이블명·정책명·SQLSTATE 가
 *   섞여 있어 사용자에게 아무 도움이 안 되고 내부 구조만 드러낸다.
 *   우리가 «사람에게 하는 말로» 쓴 것만 통과시킨다.
 */
export function userFacingMessage(error: unknown): string {
  if (error instanceof UserFacingActionError) return error.message;
  if (error instanceof ValidationError) return `입력을 확인해 주세요 — ${error.message}`;
  return "항목을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

/** 플래시 쿠키 이름. */
export const BOARD_ACTION_FLASH_COOKIE = "mw_board_err";

/** 쿠키 수명(초). 다음 렌더에서 읽히기만 하면 되므로 짧게 둔다. */
export const BOARD_ACTION_FLASH_MAX_AGE = 10;

/** 쿠키에 담을 최대 인코딩 길이(헤더 비대 방지). */
const MAX_ENCODED_LENGTH = 1200;

/** 메시지 상한. 한글은 encodeURIComponent 에서 글자당 9자로 부푸는 점을 감안한다. */
const MAX_MESSAGE_LENGTH = 120;

export type BoardActionFlash = {
  /** 어느 보드에서 난 오류인지 — 다른 보드로 이동하면 표시하지 않는다. */
  boardId: string;
  /** 사용자에게 보여줄 사유. */
  message: string;
};

function clamp(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** 플래시를 쿠키 값으로 직렬화. 담을 것이 없으면 `null`. */
export function encodeBoardActionFlash(flash: BoardActionFlash): string | null {
  const boardId = clamp(flash.boardId, 64);
  const message = clamp(flash.message, MAX_MESSAGE_LENGTH);
  if (!boardId || !message) return null;

  // 길면 버리지 않고 «줄여서» 담는다 — 알리려다 아무것도 안 보이는 상황을 피한다.
  let lo = 0;
  let hi = message.length;
  let best: string | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const candidate = encodeURIComponent(JSON.stringify({ boardId, message: message.slice(0, mid) }));
    if (candidate.length <= MAX_ENCODED_LENGTH) {
      best = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * 쿠키 값 → 플래시. 형식이 어긋나면 `null`(표시하지 않는다).
 * 쿠키는 사용자가 조작할 수 있으므로 구조를 신뢰하지 않고 전부 검사한다.
 */
export function decodeBoardActionFlash(raw: string | undefined | null): BoardActionFlash | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const obj = parsed as Record<string, unknown>;
  const boardId = clamp(obj.boardId, 64);
  const message = clamp(obj.message, MAX_MESSAGE_LENGTH);
  return boardId && message ? { boardId, message } : null;
}

/** 이 보드의 오류 메시지. 다른 보드 것이면 `null`. */
export function findBoardActionError(flash: BoardActionFlash | null, boardId: string): string | null {
  return flash && flash.boardId === boardId ? flash.message : null;
}
