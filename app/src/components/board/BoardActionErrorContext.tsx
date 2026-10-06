"use client";

/**
 * 직전 보드 액션의 실패 사유를 «화면 어디서든» 읽게 한다 (#654).
 *
 * ★ 보드 화면의 오류 배너는 페이지 맨 위에 그려진다. 그런데 행 상세 패널은 화면 전체를 덮는
 *   대화상자라서, 패널 안에서 누른 액션이 실패하면 그 배너가 패널 «뒤» 에 그려진다 —
 *   사용자에겐 아무 일도 없었던 것처럼 보인다. 패널이 같은 사유를 자기 안에서 다시 말하도록
 *   사유를 여기로 흘려 둔다. 제공자가 없으면 null 이다(픽스처·테스트 렌더).
 */

import { createContext, useContext, type ReactNode } from "react";

const BoardActionErrorContext = createContext<string | null>(null);

export function BoardActionErrorProvider({
  message,
  children,
}: {
  message: string | null;
  children: ReactNode;
}) {
  return <BoardActionErrorContext.Provider value={message}>{children}</BoardActionErrorContext.Provider>;
}

export function useBoardActionError(): string | null {
  return useContext(BoardActionErrorContext);
}
