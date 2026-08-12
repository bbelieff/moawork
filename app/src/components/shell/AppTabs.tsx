"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";
import { APP_TABS, matchTabByPathname } from "./app-tabs";
import { NAV_ITEMS } from "./nav-items";

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

const LABEL_BY_TAB_KEY = new Map(
  NAV_ITEMS.map((item) => [item.key, item.label] as const),
);

const ICON_BY_TAB_KEY = new Map(
  NAV_ITEMS.map((item) => [item.key, item.icon] as const),
);

type Props = {
  /** 서버가 계산한 잠긴 기능키 — 사이드바와 같은 진실을 쓴다(엔타이틀먼트는 서버 소유). */
  lockedFeatures: string[];
};

export function AppTabs({ lockedFeatures }: Props) {
  const pathname = usePathname();
  const active = matchTabByPathname(pathname);
  // 탭 밖 화면에서는 탭 줄 자체가 없다. 여섯 탭 중 하나를 보고 있을 때만 그린다.
  if (!active) return null;

  const locked = new Set(lockedFeatures);

  return (
    <nav
      aria-label="업무 탭"
      data-testid="app-tabs"
      className="mb-[var(--sp-4)] flex items-center overflow-x-auto"
      style={{ gap: "var(--sp-1, 4px)", borderBottom: "1px solid var(--mw-line)", paddingBottom: "var(--sp-2)" }}
    >
      {APP_TABS.map((tab) => {
        const href = tab.canonicalHref;
        if (!href) return null;
        const feature = FEATURE_BY_TAB_KEY.get(tab.key);
        const isLocked = feature ? locked.has(feature) : false;
        const isActive = active.key === tab.key;
        const label = LABEL_BY_TAB_KEY.get(tab.key) ?? tab.mockupLabel;
        const icon = ICON_BY_TAB_KEY.get(tab.key);

        return (
          <Link
            key={tab.key}
            href={href}
            data-tab-key={tab.key}
            aria-current={isActive ? "page" : undefined}
            aria-disabled={isLocked ? "true" : undefined}
            title={tab.mockupLabel}
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
            <span>{label}</span>
            {isLocked ? (
              <span style={{ color: "var(--mw-sub)" }} title="이 조직에 켜져 있지 않은 기능입니다">
                <Icon name="lock" />
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
