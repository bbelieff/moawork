"use client";

import { usePathname } from "next/navigation";
import { Icon } from "./icons";
import { APP_TABS, matchTabByPathname } from "./app-tabs";
import { NAV_ITEMS } from "./nav-items";
import { workspaceHref } from "./workspace-href";

// 목업 「탭 6개 한 화면」의 탭 줄 — BBE-142.
//
// 목업(UI목업_워크스페이스_최종_v6)은 여섯 업무 화면을 «한 셸 안에서» 오간다. 앱은 주소가
// 나뉘어 있으므로, 주소는 그대로 두되 셸이 여섯 탭을 «항상 같은 자리»에 그려서 전환이
// 한 화면 안에서 일어나는 것처럼 만든다. 이것이 app-tabs.ts 를 실제로 소비하는 지점이다
// (그 파일이 정적 분류표로만 남아 있으면 셸은 아무것도 바뀌지 않는다).
//
// ⚠ 탭 밖(설정·계정·플랫폼 어드민·대시보드)에서는 그리지 않는다 — OUT_OF_TAB_HREFS 가 정본.
// ⚠ 탭 목록은 아직 «목업 기본값» 이다. D76·D77(회사가 탭을 만들고 지운다 · 0개도 정상)에 따라
//    boards 를 읽어 그리는 것이 다음 단계다. 지금 0개를 그려야 할 데이터 원천이 셸에 없다.

const FEATURE_BY_TAB_KEY = new Map(
  NAV_ITEMS.map((item) => [item.key, item.feature] as const),
);

const ICON_BY_TAB_KEY = new Map(
  NAV_ITEMS.map((item) => [item.key, item.icon] as const),
);

export type AppTabsProps = {
  /** 서버가 계산한 잠긴 기능키 — 사이드바와 같은 진실을 쓴다(엔타이틀먼트는 서버 소유). */
  lockedFeatures: string[];
  /** Verified active-membership namespace, for example `/w/acme`. */
  workspaceBasePath?: string;
  /** Server-resolved destinations whose board id is tenant-specific. */
  directHrefs?: Partial<Record<(typeof APP_TABS)[number]["key"], string>>;
};

export function AppTabs({ lockedFeatures, workspaceBasePath, directHrefs }: AppTabsProps) {
  const pathname = usePathname();
  const internalPathname = workspaceBasePath && pathname &&
    (pathname === workspaceBasePath || pathname.startsWith(`${workspaceBasePath}/`))
    ? pathname.slice(workspaceBasePath.length) || "/"
    : pathname;
  const active = matchTabByPathname(internalPathname);

  const locked = new Set(lockedFeatures);

  return (
    <nav
      aria-label="업무 탭"
      data-testid="app-tabs"
      className="mb-[var(--sp-4)] flex items-center overflow-x-auto"
      style={{ gap: "var(--sp-1, 4px)", borderBottom: "1px solid var(--mw-line)", paddingBottom: "var(--sp-2)" }}
    >
      {APP_TABS.map((tab) => {
        const canonicalHref = directHrefs?.[tab.key] ?? tab.canonicalHref;
        if (!canonicalHref) return null;
        const href = workspaceHref(workspaceBasePath, canonicalHref);
        const feature = FEATURE_BY_TAB_KEY.get(tab.key);
        const isLocked = feature ? locked.has(feature) : false;
        const isActive = active?.key === tab.key;
        const icon = ICON_BY_TAB_KEY.get(tab.key);

        return (
          <a
            key={tab.key}
            href={href}
            data-tab-key={tab.key}
            aria-current={isActive ? "page" : undefined}
            aria-disabled={isLocked ? "true" : undefined}
            // ⚠ 네이티브 `title` 툴팁을 여기 달지 마라 (BBE-214).
            //    이 <nav> 는 «레이아웃» 에 있어서 화면을 옮겨도 언마운트되지 않는다
            //    (app/(app)/layout.tsx — 바뀌는 것은 <main>{children}</main> 뿐이다).
            //    그래서 탭을 누르면 본문만 비고 탭 줄은 그대로 남는데, 브라우저가 그린
            //    title 툴팁은 «앱이 지울 수 없어» 이미 떠난 화면 위에 계속 떠 있었다.
            //    게다가 이 툴팁은 바로 옆 <span> 의 라벨과 «같은 글자» 라 알려주는 것도 없었다.
            className={`flex flex-none items-center ${isActive ? "font-semibold" : "hover:bg-[var(--mw-bg)]"}`}
            style={{
              gap: "var(--sp-2)",
              height: "var(--mw-shell-item-h)",
              borderRadius: "var(--mw-r-3)",
              paddingInline: "var(--sp-3)",
              fontSize: "var(--fs-13)",
              whiteSpace: "nowrap",
              ...(isActive
                ? { background: "var(--mw-record)", color: "var(--mw-on-accent)" }
                : { color: isLocked ? "var(--mw-sub)" : "var(--mw-fg)" }),
            }}
          >
            {icon ? <Icon name={icon} /> : null}
            <span>{tab.mockupLabel}</span>
            {isLocked ? (
              // title 이 아니라 aria-label 이다 (BBE-214): 이 <nav> 는 화면을 옮겨도
              // 언마운트되지 않아서, 네이티브 title 툴팁이 떠 있으면 새 화면 위에 그대로 남는다.
              // aria-label 은 툴팁을 만들지 않으므로 잔상이 없고, 뜻은 보조기기에 그대로 전달된다.
              <span style={{ color: "var(--mw-sub)" }} aria-label="이 조직에 켜져 있지 않은 기능입니다">
                <Icon name="lock" />
              </span>
            ) : null}
          </a>
        );
      })}
    </nav>
  );
}
