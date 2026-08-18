// 휴지통 액션의 «상태 모양» — 순수 모듈 (BBE-225 후속).
//
// ★ 왜 액션 파일에서 여기로 나왔나
//   `"use server"` 파일은 **모든 export 가 async 함수여야** 한다. 상수를 하나라도 export 하면
//   Next 가 그 페이지의 서버 액션 로더를 평가할 때 통째로 터진다:
//     A "use server" file can only export async functions, found object.
//
//   ★★ 그런데 `tsc` 도 vitest 도 `next build` 도 이것을 잡지 못한다(셋 다 실측 exit 0).
//      **dev 런타임에서, 그 페이지의 액션을 실제로 눌렀을 때만** 드러난다.
//      그래서 「게이트가 초록이다」가 여기서는 근거가 되지 못한다.
//
//   같은 함정을 `lib/boards/boardActionFlash.ts`(BBE-201)가 이미 주석으로 적어 뒀다.
//   적어 둔 사람과 밟은 파일이 두 칸 떨어져 있었을 뿐이다. 그래서 이번에는 «규칙» 이 아니라
//   «파일» 로 남긴다 — 상수를 여기 두는 한 액션 파일이 규칙을 어길 수 없다.
//
//   타입(`interface`)은 컴파일에서 지워지므로 액션 파일에 있어도 문제가 없지만,
//   상수와 짝이라 같이 둔다. 다음 사람이 두 곳을 오가지 않게.

export interface TrashActionState {
  ok: boolean;
  message: string | null;
}

export const INITIAL_TRASH_ACTION_STATE: TrashActionState = { ok: true, message: null };
