// 액션 결과 배너의 «표현» 을 판정 근거에서 파생시킨다 (BBE-208).
//
// ★ 이 저장소가 반복한 병: 판정 근거(`result.ok`)를 «제어흐름엔» 쓰고 «표현에선» 버린다.
//   BBE-183 은 성공이 빨간 오류로, BBE-193 은 표현이 판정을 안 읽어서,
//   BBE-204 는 「확인 불가」와 「권한 없음」이 같은 404 로, 그리고 이 카드는
//   실패가 「처리됐다」로 읽혔다. **방향만 다르고 원인은 하나다.**
//
// ★ 그래서 role 과 색을 «각각» 쓰지 않는다. 둘 다 이 한 곳에서 판정으로부터 나온다.
//   한 채널만 판정을 읽으면 같은 화면이 두 사용자에게 다른 사실을 말한다 —
//   눈으로 보는 사용자는 빨간색을 보는데 보조기술 사용자는 「상태」로 듣는다.
//   (WorkspaceEntry.tsx:224 가 정확히 그 상태였다.)

/** 액션 결과 배너에 필요한 최소 정보. `ok` 가 유일한 판정 근거다. */
export type ResultNotice = { ok: boolean; message: string };

/**
 * 실패는 `alert` 로 «끼어들어» 알린다. 성공은 `status` 로 조용히 알린다.
 *
 * 실패를 `status` 로 두면 보조기술 사용자는 그 사실을 놓치거나 «처리됐다» 로 듣는다.
 * 반대로 성공까지 `alert` 로 두면(전부 빨갛게 칠해서 도망) 경고가 의미를 잃는다.
 * **양쪽 다 결함이다.**
 */
export function noticeRole(ok: boolean): "status" | "alert" {
  return ok ? "status" : "alert";
}

/** 실패는 즉시 읽히도록 assertive, 성공은 polite. */
export function noticeLive(ok: boolean): "polite" | "assertive" {
  return ok ? "polite" : "assertive";
}
