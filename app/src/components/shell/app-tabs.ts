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
    altHrefs: ["/policyfund", "/policyfund/settlements"],
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
  "/dash/[pipelineId]",
  "/dash/all",
  "/dash/tasks",
  "/deals/[dealId]",
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
