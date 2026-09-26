/**
 * 「지금 어느 탭에 있는가」를 «하나만» 고른다.
 *
 * ★ 왜 필요했나 — 기본 탭 주소는 전부 «경유지» 다.
 *   `/work`·`/contract`·`/newcust`·`/notices` 는 진입하자마자 `/boards/<id>` 로 넘긴다
 *   (`lib/work/entry.ts` 등). 그래서 사용자가 실제로 머무는 주소에는 `/work` 라는 글자가
 *   없고, 항목마다 `pathname.startsWith(href)` 로 판정하던 예전 방식은 «아무것도 활성 아님» 이 됐다.
 *   탭에 들어가 있는데 사이드바가 전부 회색이었던 것이 그 때문이다.
 *
 * ★ 항목별 판정이 아니라 «한 번에 하나» 를 고르는 이유.
 *   startsWith 를 항목마다 돌리면 `/settings/…` 처럼 겹치는 주소에서 둘이 같이 켜진다.
 *   둘이 켜지면 색으로 구분한다는 목적 자체가 깨진다 — 그래서 가장 깊이 일치하는 하나만 남긴다.
 *
 * ★ source 문자열을 «상수 대신 글자» 로 적는 이유.
 *   이 파일은 사이드바(클라이언트 부품)가 읽는다. `@/lib/default-tabs` 를 import 하면
 *   그 배럴이 `install.ts` → `supabase/server` 까지 끌고 와서 빌드가 서버 전용 모듈을
 *   클라이언트 번들에 넣으려다 멈춘다. 대신 `active-nav.test.ts` 가 이 네 글자를
 *   정본 상수와 대조하므로, 상수가 바뀌면 테스트가 먼저 빨개진다.
 */
export const TAB_SOURCE_NAV_KEY: Readonly<Record<string, string>> = {
  "core.default-tab/new-lead": "new",
  "core.default-tab/contact": "contact",
  "core.default-tab/contract-work": "work",
  "core.default-tab/notice": "notice",
};

export type NavCandidate = { key: string; href: string };

/** `/w/acme/boards/<id>` · `/boards/<id>` 에서 보드 id 를 뽑는다. 보드 화면이 아니면 null. */
export function boardIdFromPathname(pathname: string): string | null {
  const match = /(?:^|\/)boards\/([^/?#]+)/.exec(pathname);
  return match ? match[1] : null;
}

/** 주소가 그 항목«이거나 그 아래» 인가 — 세그먼트 경계에서만 참이다(`/w/acme` 가 `/w/acme-2` 를 먹지 않게). */
function covers(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}

/**
 * 상담 단계 보기의 활성 탭 — 같은 리드컨택 정본 보드(`/boards/<id>`)라도
 * `?consultation=remote|inperson` 이면 STEP2·STEP3 탭이 켜진다.
 * 쿼리가 없거나 contact 보드가 아니면 null(기존 판정 그대로).
 */
export function resolveConsultationNavKey(
  pathname: string,
  search: string | null | undefined,
  boardNavKeys?: Readonly<Record<string, string>>,
): "consult-remote" | "consult-inperson" | null {
  const boardId = boardIdFromPathname(pathname);
  if (!boardId || boardNavKeys?.[boardId] !== "contact") return null;
  if (!search) return null;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const view = params.get("consultation");
  if (view === "remote") return "consult-remote";
  if (view === "inperson") return "consult-inperson";
  return null;
}

export function resolveActiveNavKey(
  pathname: string,
  candidates: readonly NavCandidate[],
  options: { basePath?: string; boardNavKeys?: Readonly<Record<string, string>> } = {},
): string | null {
  const { basePath, boardNavKeys } = options;

  // ① 보드 화면이면 그 보드가 어느 탭인지가 가장 정확한 답이다.
  //    주소만 보면 `/boards/<uuid>` 라 아무 메뉴와도 안 닮았다.
  const boardId = boardIdFromPathname(pathname);
  if (boardId) {
    const fromBoard = boardNavKeys?.[boardId];
    if (fromBoard) return fromBoard;
  }

  let best: NavCandidate | null = null;
  for (const candidate of candidates) {
    // 대시보드(= 워크스페이스 뿌리)는 «정확히 그 주소» 일 때만이다.
    // 아니면 모든 하위 화면이 대시보드로 보인다 — 예전 코드가 그랬다.
    const matched =
      candidate.href === basePath ? pathname === candidate.href : covers(pathname, candidate.href);
    if (!matched) continue;
    if (!best || candidate.href.length > best.href.length) best = candidate;
  }
  return best?.key ?? null;
}
