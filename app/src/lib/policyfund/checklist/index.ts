// BBE-110 · 서류 체크리스트 공개 API.
export * from "./types";
export * from "./engine";
export * from "./products";
export { ChecklistService, NoProductSelectedError, getChecklistService } from "./service";

// ⚠ `./actions`(서버 액션)는 배럴에서 제외 — "use server" 모듈은 클라이언트 컴포넌트가
//   직접 `@/lib/policyfund/checklist/actions` 에서 import 한다(boards/actions.ts 와 동일 관례).
//   배럴에 섞으면 이 배럴을 쓰는 다른 클라이언트 코드에 서버 전용 경로가 끌려온다.
