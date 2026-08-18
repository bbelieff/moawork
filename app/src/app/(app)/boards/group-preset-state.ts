// 그룹 프리셋 액션의 «상태 모양» — 순수 모듈 (BBE-174 / BBE-217 규칙).
//
// ★ 왜 액션 파일에서 여기로 나왔나
//   `"use server"` 파일은 **모든 export 가 async 함수여야** 한다. 상수를 하나라도 export 하면
//   Next 가 그 페이지의 서버 액션 로더를 평가할 때 통째로 터진다:
//     A "use server" file can only export async functions, found object.
//
//   ★★ 그리고 `tsc`·vitest·`next build` 셋 다 이걸 못 잡는다(전부 exit 0). 그 페이지의
//      액션을 «눌렀을 때» 만 드러난다 — 총괄이 운영에서 본 전면 오류가 정확히 그 모양이었다.
//      프로덕션 빌드 산출물에는 `"async": false` 로 «등록까지» 돼 있었다.
//
//   같은 결함을 `boards/trash-actions.ts` 가 먼저 밟았고(BBE-217) 그 수정이
//   `boards/trash-action-state.ts` 다. 이 파일은 그 규약을 그대로 따른다.
//
//   ★ 관용구가 유도한 결함이다 — `INITIAL_*_STATE` + `useActionState` 는 React 문서가
//     권하는 모양이라 액션 파일에 상수를 두는 게 자연스러워 보인다. 그래서 두 사람이
//     각자 독립적으로 같은 함정을 밟았다. 「조심하자」로는 안 막히고, 상수를 둘 자리를
//     «파일로» 정해 두는 것으로 막는다.
//
//   타입은 컴파일에서 지워지므로 액션 파일에 남아도 규칙 위반이 아니지만, 상수와 짝이라
//   같이 둔다. 다음 사람이 두 곳을 오가지 않게.

export interface GroupPresetActionState {
  ok: boolean;
  message: string | null;
}

export const INITIAL_GROUP_PRESET_STATE: GroupPresetActionState = { ok: true, message: null };
