import { createContext } from "react";

/**
 * Issue 857 — 보드 화면(BoardWorkspace)이 셀 저장을 맡는다. 셀은 이 저장을 폼 action 으로 쓰고,
 * 값은 누른 즉시 바뀌고 서버 확인은 뒤에서 온다. 없으면(시각 fixture 등) 기존 서버 액션 경로 그대로.
 */
export type CellSaveApi = {
  save: (formData: FormData) => Promise<void>;
  /** 이 칸에 보일 저장 결과 한 줄. undefined = 이 화면에서 저장한 적 없음(서버 플래시를 따른다), null = 지움. */
  messageFor: (itemId: string, columnKey: string) => string | null | undefined;
};

export const CellSaveContext = createContext<CellSaveApi | null>(null);
