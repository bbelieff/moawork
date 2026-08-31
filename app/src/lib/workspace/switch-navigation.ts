/**
 * 워크스페이스를 «어떻게» 옮기는가 (#671).
 *
 * ## 왜 클라이언트 라우팅이면 안 되나
 *
 * 목적지 `/w/<slug>` 는 **페이지가 아니라 Route Handler** 다
 * (`app/src/app/w/[slug]/route.ts`). 하는 일이 이것이다:
 *
 *     NextResponse.rewrite(내부경로)  +  cookies.set(SESSION_COOKIE.org, orgId)
 *
 * **워크스페이스가 바뀌는 실체는 그 쿠키다.** 그런데 App Router 의 클라이언트 이동은
 * RSC 페이로드를 기대하고 `?_rsc=` 를 붙여 가져간다 — Route Handler 의 rewrite 응답으로는
 * 라우터가 상태를 맞추지 못하고, 쿠키를 심으려면 **진짜 문서 요청**이 필요하다.
 *
 * 그래서 여기서는 «브라우저에게 그 주소로 가라» 고 말한다. 되돌아올 곳이 없는 이동이므로
 * `assign` 이 맞다 — 뒤로 가기를 눌렀을 때 이전 워크스페이스로 돌아가는 것이 자연스럽다.
 *
 * ## 왜 화면 밖인가
 *
 * 컴포넌트 안에 두면 검사할 자리가 없어진다(#638). 여기는 DOM 을 모른다 —
 * «어떤 방식으로 갈 것인가» 만 정하고 돌려준다.
 */

/** 워크스페이스 전환은 서버가 쿠키를 심어야 완성된다 — 문서 요청이어야 한다. */
export const WORKSPACE_PATH = /^\/w\/[^/?#]+(?:[/?#]|$)/u;

export type NavigationKind = "document" | "client";

/**
 * 이 목적지는 «문서 요청» 이어야 하는가.
 *
 * ★ 판정을 «주소» 로 한다. 「워크스페이스를 고른 경우」 같은 호출자 사정으로 나누면,
 *   나중에 같은 주소를 다른 곳에서 부를 때 조용히 클라이언트 이동으로 새 버릇이 든다.
 */
export function navigationKindFor(destination: string): NavigationKind {
  return WORKSPACE_PATH.test(destination) ? "document" : "client";
}

/**
 * 이동이 «시작됐는가».
 *
 * ★ 이것이 이 파일의 핵심이다. 전에는 이동을 건 뒤 busy 를 «영원히» 켜 둔 채로
 *   컴포넌트가 사라지기만 기다렸다(#671). 사라지지 않으면 버튼이 다시는 안 눌린다 —
 *   사용자 눈에는 그냥 멈춘 것이다.
 *
 *   그래서 «시작됐다» 와 «끝났다» 를 나눈다. 문서 이동은 브라우저가 페이지를 버릴
 *   것이므로 busy 를 유지해도 되지만, 그것도 **끝내 안 떠날 수 있다**(팝업 차단·오류).
 *   그때를 위해 호출자가 풀 수 있는 시한을 같이 준다.
 */
export const NAVIGATION_STALL_MS = 4000;
