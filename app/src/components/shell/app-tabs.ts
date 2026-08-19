// 목업 「탭 6개 한 화면」 ↔ 앱 주소 대조표 — BBE-142.
//
// 목업(dump-mockup.mjs)은 여섯 업무 탭을 하나의 셸 안에서 전환한다. 앱은 지금 여러 독립
// 라우트로 나뉘어 있다. 이 파일이 "무엇이 어느 탭에 속하는가"의 정본이다 — 흩어진 주소를
// 강제로 하나로 합치지 않는다(D73: 줄이지 않는다). 대신 각 탭이 가리키는 대표 주소(canonical)와
// 그 탭 안에 있다고 볼 수 있는 나머지 주소(legacy/alt)를 명시적으로 분류한다.
//
// 카드가 표기한 "주소 25개"는 실측 39개와 다르다 — 이 카드 착수 시점 재실측값으로 정정한다.
//
// work 탭의 canonicalHref는 2026-08-11 MWC 데이터-완성도 결정(→/policyfund, 재검토 안 함)을
// 2026-08-12 총괄 지시(BBE-142 PR #166 인계)로 뒤집는다: /policyfund 는 앱 셸 밖 옛 미리보기,
// /work 는 셸 안의 새 화면이다. /policyfund 페이지는 지우지 않는다 — 총괄이 후속 정리한다.

export type AppTab = {
  key: string;
  /** 목업 원문 라벨(dump-mockup.mjs 기준) — 사이드바 라벨(nav-items.ts)과 다를 수 있다. */
  mockupLabel: string;
  /** 이 탭을 대표하는 주소. 사이드바 href 와 같다(있는 경우). */
  canonicalHref: string | null;
  /** 같은 탭에 속하지만 대표 주소가 아닌 것들 — 신규 엔진, 하위 라우트, 구 버전 등. */
  altHrefs: readonly string[];
};

export const APP_TABS: readonly AppTab[] = [
  {
    key: "new",
    mockupLabel: "신규리드 관리",
    canonicalHref: "/newcust",
    altHrefs: ["/boards", "/boards/[id]"],
  },
  {
    key: "contact",
    mockupLabel: "리드컨택 관리",
    canonicalHref: "/contract",
    altHrefs: [],
  },
  {
    key: "work",
    mockupLabel: "계약업체 실무",
    canonicalHref: "/work",
    altHrefs: ["/policyfund"],
  },
  {
    key: "company",
    mockupLabel: "업체관리 현황",
    canonicalHref: "/companies",
    altHrefs: ["/companies/[companyId]"],
  },
  {
    key: "notice",
    mockupLabel: "공지사항",
    canonicalHref: "/notices",
    altHrefs: ["/notices/[noticeId]"],
  },
  {
    key: "preset",
    mockupLabel: "프리셋 라이브러리",
    canonicalHref: "/presets",
    altHrefs: [],
  },
] as const;

/**
 * 6탭 어디에도 속하지 않는 주소 — 카드 본문이 "탭 밖이 맞다"고 명시한 것과 같은 부류다.
 * (대시보드 · 계정/설정 · 플랫폼 어드민 · 온보딩 · 워크스페이스 전환 · 인증)
 * 여기 없는 주소가 새로 생기면 이 목록도 갱신해야 한다 — qa-app.mjs 류의 자동 검사가
 * 아직 이 파일을 읽지 않으므로(§NG-02 후속) 지금은 사람이 유지한다.
 */
export const OUT_OF_TAB_HREFS: readonly string[] = [
  "/",
  "/login",
  // BBE-186: 홈에서 옮겨 온 업무 분석. 6탭이 아니라 홈의 «바로 가기» 로 들어간다.
  "/dash",
  "/dash/[pipelineId]",
  "/dash/all",
  "/dash/tasks",
  "/deals/[dealId]",
  // BBE-240: 연도별 전체 원장 — 사이드바(nav-items.ts "acct")에는 있지만 6탭엔 안 낀다.
  "/ledger",
  "/mode",
  "/onboarding",
  "/onboarding/practice",
  "/workspace-entry",
  "/workspaces",
  "/account",
  "/settings/account",
  "/settings/account/privacy",
  "/settings/account/sessions",
  "/settings/automations",
  "/settings/members",
  "/settings/members/approvals",
  "/settings/notifications",
  "/settings/workspace-builder",
  "/platform",
  "/platform/access",
  "/platform/admins",
  "/platform/analytics",
  "/platform/billing",
  "/platform/demo",
  "/platform/metrics",
  "/platform/organizations",
  "/platform/support",
  "/platform/system",
  "/platform/workspace-requests",
] as const;

export function findTabByHref(href: string): AppTab | undefined {
  return APP_TABS.find((tab) => tab.canonicalHref === href || tab.altHrefs.includes(href));
}

/**
 * 라우트 «패턴»(`/companies/[companyId]`)을 실제 «주소»(`/companies/c-1`)와 맞춰 보기 위한 정규식.
 * 대괄호 세그먼트는 한 칸(`/` 없는 아무 값)으로 친다 — Next 의 동적 세그먼트 규칙과 같다.
 */
function hrefToPattern(href: string): RegExp {
  const source = href
    .split("/")
    .map((segment) =>
      segment.startsWith("[") && segment.endsWith("]")
        ? "[^/]+"
        : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(`^${source}$`);
}

/**
 * 지금 열려 있는 주소가 «6탭 중 어느 탭인가». 셸의 탭 줄(AppTabs)이 활성 표시에 쓴다.
 *
 * findTabByHref 와 다르다 — 저쪽은 «패턴 문자열» 을 그대로 찾고(정적 분류표 조회),
 * 이쪽은 «브라우저에 떠 있는 실제 경로» 를 판정한다. 탭 줄은 후자가 필요하다.
 *
 * 탭 밖(설정·계정·플랫폼 어드민 등)을 «먼저» 걸러낸다 — 그 화면들에서는 탭 줄을 그리지 않는다.
 */
export function matchTabByPathname(pathname: string | null | undefined): AppTab | undefined {
  // 경로를 모르면 «탭이 아니다». usePathname() 은 라우터 문맥 밖(서버 렌더 테스트 등)에서
  // null 을 준다 — 그때 셸이 터지면 안 된다. 탭 줄을 안 그리는 것이 옳은 결과다.
  if (typeof pathname !== "string" || pathname.length === 0) return undefined;
  const path = pathname !== "/" && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (OUT_OF_TAB_HREFS.some((href) => hrefToPattern(href).test(path))) return undefined;
  return APP_TABS.find((tab) =>
    [tab.canonicalHref, ...tab.altHrefs]
      .filter((href): href is string => Boolean(href))
      .some((href) => hrefToPattern(href).test(path)),
  );
}
