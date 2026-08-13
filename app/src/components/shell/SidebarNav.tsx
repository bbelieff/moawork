"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  WorkspaceSwitcher,
  type WorkspaceSwitcherProps,
} from "@/components/workspace/WorkspaceSwitcher";
import { Badge } from "@/components/notify/Badge";
import type { BadgeState } from "@/lib/notify/types";
import { Icon } from "./icons";
import {
  NAV_SECTIONS,
  navItemsForSection,
  type NavBadgeKey,
  type NavItem,
} from "./nav-items";
import { GlobalSearch } from "./GlobalSearch";

// 사이드바 메뉴 목록 — 활성 표시를 위해 클라이언트 컴포넌트.
// 잠금/미구현 판정은 서버(레이아웃)에서 내려받는다(엔타이틀먼트는 서버 진실).

type Props = {
  /** 서버에서 계산한 "잠긴 기능키" 집합 — 이 기능을 요구하는 메뉴는 자물쇠. */
  lockedFeatures: string[];
  /** 서버에서 범위 검증을 마친 배지만 받는다. 값이 없으면 숫자를 만들지 않는다. */
  badges?: Partial<Record<NavBadgeKey, number>>;
  /**
   * mod.notify 뱃지 — nav key → 숫자(내 할 일) 또는 점(안 본 변화).
   * 위 `badges`(서버 검증 키 전용 계약)를 침범하지 않도록 별도 prop 으로 받는다.
   * 숫자는 화면 진입만으로 사라지지 않고, 점은 진입하면 사라진다.
   */
  notifyBadges?: Record<string, BadgeState>;
  workspaceSwitcher?: Omit<WorkspaceSwitcherProps, "onNavigate">;
};

export function SidebarNav({
  lockedFeatures,
  badges,
  notifyBadges,
  workspaceSwitcher,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const locked = new Set(lockedFeatures);

  const renderItem = (item: NavItem, nested: boolean) => {
    const isLocked = item.feature ? locked.has(item.feature) : false;
    // 실제 라우트가 있는 잠금 메뉴는 안내 화면에 도달할 수 있도록 링크를 유지한다.
    const unavailable = !item.href;
    const active =
      !isLocked && !unavailable &&
      (item.href === "/"
        ? pathname === "/"
        : pathname.startsWith(item.href!));

    const badge = item.badgeKey ? badges?.[item.badgeKey] : undefined;
    const visibleBadge = typeof badge === "number" && Number.isSafeInteger(badge) && badge > 0
      ? badge
      : null;
    // 승인 대기 숫자(서버 검증)가 있으면 그것을 우선한다 — 알림 점이 덮지 않도록.
    const notifyBadge = visibleBadge === null ? notifyBadges?.[item.key] : undefined;
    const showNotifyBadge = notifyBadge !== undefined && notifyBadge.kind !== "none" && !isLocked;

    const inner = (
      <>
        <Icon name={item.icon} />
        <span className="flex-1 truncate">{item.label}</span>
        {visibleBadge !== null ? (
          <span
            className="ml-auto font-bold"
            aria-label={`승인 대기 ${visibleBadge}건`}
            style={{
              background: "var(--mw-tint-coral)",
              color: "var(--mw-people)",
              borderRadius: "var(--mw-r-1)",
              paddingBlock: "var(--sp-1)",
              paddingInline: "var(--sp-2)",
              fontSize: "var(--mw-shell-badge-fs)",
            }}
          >
            {visibleBadge > 99 ? "99+" : visibleBadge}
          </span>
        ) : showNotifyBadge ? (
          <span className="ml-auto flex items-center">
            <Badge state={notifyBadge} label={item.label} />
          </span>
        ) : null}
        {isLocked ? (
          <span
            className="ml-auto"
            style={{ color: "var(--mw-sub)", fontSize: "var(--fs-11)" }}
            title="이 조직에 켜져 있지 않은 기능입니다"
          >
            <Icon name="lock" />
          </span>
        ) : unavailable ? (
          <span
            className="ml-auto"
            style={{ color: "var(--mw-sub)", fontSize: "var(--mw-shell-badge-fs)" }}
            title="담당 트랙에서 화면 준비 중"
          >
            준비 중
          </span>
        ) : null}
      </>
    );

    const base = "flex items-center";
    const baseStyle = {
      gap: "var(--sp-2)",
      height: "var(--mw-shell-item-h)",
      borderRadius: "var(--mw-r-3)",
      paddingLeft: nested ? "var(--sp-6)" : "var(--sp-3)",
      paddingRight: "var(--sp-3)",
      fontSize: "var(--mw-shell-item-fs)",
    } as const;

    if (unavailable) {
      return (
        <span
          key={item.key}
          data-nav-key={item.key}
          role="link"
          aria-disabled="true"
          tabIndex={0}
          onClick={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") event.preventDefault();
          }}
          className={`${base} cursor-not-allowed`}
          style={{ ...baseStyle, color: "var(--mw-sub)" }}
        >
          {inner}
        </span>
      );
    }

    return (
      <Link
        key={item.key}
        data-nav-key={item.key}
        href={item.href!}
        aria-disabled={isLocked ? "true" : undefined}
        aria-current={active ? "page" : undefined}
        className={`${base} ${active ? "font-semibold" : "hover:bg-[var(--mw-bg)]"} ${isLocked ? "cursor-help" : ""}`}
        style={
          active
            ? { ...baseStyle, background: "var(--mw-record)", color: "var(--mw-on-accent)" }
            : { ...baseStyle, color: isLocked ? "var(--mw-sub)" : "var(--mw-fg)" }
        }
      >
        {inner}
      </Link>
    );
  };

  return (
    <>
      {workspaceSwitcher ? (
        <WorkspaceSwitcher
          {...workspaceSwitcher}
          onNavigate={async (destination) => {
            router.push(destination);
          }}
        />
      ) : null}
      <GlobalSearch />
      <nav className="hidden min-h-0 flex-1 flex-col gap-px overflow-y-auto md:flex" aria-label="주요 메뉴">
        <div
          className="border-b"
          style={{ borderColor: "var(--mw-line)", paddingBottom: "var(--sp-2)" }}
        >
          <h2 className="font-semibold" style={{ color: "var(--mw-sub)", fontSize: "var(--fs-11)", padding: "var(--sp-2) var(--sp-3)" }}>
            종합
          </h2>
          {navItemsForSection(NAV_SECTIONS[0]).map((item) => renderItem(item, false))}
        </div>

        <div
          className="border-b"
          style={{ borderColor: "var(--mw-line)", paddingBlock: "var(--sp-2)" }}
        >
          <h2 className="font-semibold" style={{ color: "var(--mw-sub)", fontSize: "var(--fs-11)", padding: "var(--sp-2) var(--sp-3)" }}>
            업무
          </h2>
          {NAV_SECTIONS.slice(1, 3).map((section) => (
            <section key={section.key} aria-labelledby={`sidebar-${section.key}`}>
              <h3 id={`sidebar-${section.key}`} className="font-semibold" style={{ color: "var(--mw-sub)", fontSize: "var(--fs-11)", padding: "var(--sp-2) var(--sp-6) var(--sp-1)" }}>
                {section.label}
              </h3>
              {navItemsForSection(section).map((item) => renderItem(item, true))}
            </section>
          ))}
          <details data-nav-section="coming-soon">
            <summary
              className="cursor-pointer font-semibold"
              style={{ color: "var(--mw-sub)", fontSize: "var(--fs-11)", padding: "var(--sp-2) var(--sp-6)" }}
            >
              준비 중
            </summary>
            {navItemsForSection(NAV_SECTIONS[3]).map((item) => renderItem(item, true))}
          </details>
        </div>

        <div style={{ paddingBlock: "var(--sp-2)" }}>
          <h2 className="font-semibold" style={{ color: "var(--mw-sub)", fontSize: "var(--fs-11)", padding: "var(--sp-2) var(--sp-3)" }}>
            설정
          </h2>
          {navItemsForSection(NAV_SECTIONS[4]).map((item) => renderItem(item, false))}
        </div>
      </nav>
    </>
  );
}
