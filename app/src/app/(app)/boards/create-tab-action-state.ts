// 사이드바 「새 탭 만들기」 액션의 «상태 모양» 과 실패 문장 — 순수 모듈 (#849 PR2).
//
// ★ 액션 파일(`"use server"`)은 async 함수 외에는 export 할 수 없다(trash-action-state.ts 머리 주석).
//   그래서 화면이 쓰는 초기 상태·문장은 여기 둔다.
//
// 왜 상태를 돌려주나: 이 폼은 모든 화면에 붙어 있는 사이드바(지속 레이아웃) 안에 있다. 액션이 던지면
//   위에 오류 경계(error.tsx)가 없어 셸 전체가 Next 기본 오류 화면으로 덮인다. 실패는 폼 아래 한 줄로 끝낸다.

import { UserFacingActionError, userFacingMessage } from "@/lib/boards/boardActionFlash";
import { ValidationError } from "@/lib/boards/validation";

export interface CreateTabActionState {
  /** 폼 아래에 보여줄 사람 말. 성공하면 액션이 새 탭으로 이동하므로 돌아오는 상태는 실패뿐이다. */
  error: string | null;
}

export const INITIAL_CREATE_TAB_ACTION_STATE: CreateTabActionState = { error: null };

export const CREATE_TAB_FAILED_MESSAGE = "탭을 만들지 못했어요. 잠시 후 다시 시도해 주세요.";
export const CREATE_TAB_REPLAY_MESSAGE = "이 창에서 이미 다른 내용으로 만들기를 보냈어요. 창을 닫고 다시 열어 주세요.";

/**
 * 실패를 «화면에 쓸 문장» 으로 바꾼다. 원본 DB 문구는 보여주지 않는다(boardActionFlash 와 같은 규칙).
 * - 권한 없음·권한 확인 실패: 액션이 이미 사람 말로 만든 문장.
 * - 이름 검증 실패: 「입력을 확인해 주세요 — …」.
 * - 같은 요청 ID 로 다른 내용(169 create_workspace_board 의 request_replay_conflict): 창을 다시 열라고 안내.
 */
export function createTabFailureMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  if (raw.includes("request_replay_conflict")) return CREATE_TAB_REPLAY_MESSAGE;
  if (error instanceof UserFacingActionError || error instanceof ValidationError) return userFacingMessage(error);
  return CREATE_TAB_FAILED_MESSAGE;
}
