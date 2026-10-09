"use client";

import Link from "next/link";
import { Suspense, useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Badge } from "@/components/notify/Badge";
import type { BadgeState } from "@/lib/notify/types";
import { TabIcon } from "@/components/board/TabIcon";
import { BoardModalLayer } from "@/components/board/BoardDialogPortal";
import { Icon, type IconName } from "./icons";
import { NavPending, isPlainClick } from "./NavPending";
import { openGlobalSearch } from "./GlobalSearch";
import { NAV_ITEMS, type NavBadgeKey, type NavItem } from "./nav-items";
import { resolveShellActiveKey } from "./shell-active-key";
import { workspaceHref } from "./workspace-href";
import { directBoardHref } from "./direct-tab-href";
import type { SidebarUserTab } from "./user-tabs";
import {
  BOTTOM_ALERTS_KEY,
  BOTTOM_HOME_KEY,
  bottomMoreSheetSections,
  bottomTabForNavKey,
  bottomWorkSheetSections,
  type BottomSheetSection,
  type BottomTabKey,
} from "./bottom-nav";

/**
 * 휴대폰 아래 메뉴 — 2026-10-09 대표 결정. md(768px) 미만에서만 보인다(넓은 화면은 사이드바 그대로).
 *
 * 홈 · 알림 · 업무 · 찾기 · 더보기 다섯 칸. 목적지·잠금·배지·활성 판정은 사이드바와 같은 정본
 * (nav-items · user-tabs · resolveShellActiveKey)을 쓴다 — 휴대폰에서만 갈 수 없는 메뉴가 생기지 않게.
 * 시트는 보드 공용 모달 층(BoardModalLayer: 초점 가둠 · Esc/바깥 눌러 닫기 · 초점 되돌림 · aria-modal)을 쓴다.
 */

export type MobileBottomNavProps = {
  lockedFeatures: string[];
  badges?: Partial<Record<NavBadgeKey, number>>;
  notifyBadges?: Record<string, BadgeState>;
  workspaceBasePath?: string;
  boardNavKeys?: Readonly<Record<string, string>>;
  userTabs?: readonly SidebarUserTab[];
  dismissedSources?: readonly string[];
};

/** 화면 키보드가 올라왔다고 보는 «보이는 높이» 감소량. 주소창 접힘(약 60–100px)보다 크다. */
const KEYBOARD_THRESHOLD_PX = 150;
const DESKTOP_QUERY = "(min-width: 48rem)";

export function MobileBottomNav(props: MobileBottomNavProps) {
  return <Suspense fallback={<MobileBottomNavContent {...props} search="" />}><MobileBottomNavQuery {...props} /></Suspense>;
}

function MobileBottomNavQuery(props: MobileBottomNavProps) {
  const search = useSearchParams()?.toString() ?? "";
  return <MobileBottomNavContent {...props} search={search} />;
}

/** 화면 키보드가 열렸는가 — visualViewport 가 눈에 띄게 줄면 참. 확대(핀치)는 scale 로 되돌려 본다. */
function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setOpen(window.innerHeight - viewport.height * viewport.scale > KEYBOARD_THRESHOLD_PX);
    update();
    viewport.addEventListener("resize", update);
    return () => viewport.removeEventListener("resize", update);
  }, []);
  return open;
}

type SheetKind = "work" | "more";

function MobileBottomNavContent({
  lockedFeatures,
  badges,
  notifyBadges,
  workspaceBasePath,
  boardNavKeys,
  userTabs,
  dismissedSources,
  search,
}: MobileBottomNavProps & { search: string }) {
  const pathname = usePathname() ?? "";
  const location = search ? `${pathname}?${search}` : pathname;
  const keyboardOpen = useKeyboardOpen();
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  // 누른 순간 그 칸을 켠다(사이드바와 같은 즉시 반응). 주소가 바뀌면 실제 주소 기준 판정으로 돌아간다.
  const [pendingTab, setPendingTab] = useState<{ tab: BottomTabKey; from: string } | null>(null);
  if (pendingTab && pendingTab.from !== location) setPendingTab(null);
  const [settle] = useState(() => () => setPendingTab(null));
  const [sheetFrom, setSheetFrom] = useState(location);
  if (sheetFrom !== location) {
    setSheetFrom(location);
    if (sheet) setSheet(null);
  }

  // 넓은 화면으로 바뀌면(회전·창 크기) 시트를 닫는다 — 그 폭에는 아래 메뉴가 없다.
  useEffect(() => {
    if (!sheet || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(DESKTOP_QUERY);
    const close = () => { if (query.matches) setSheet(null); };
    close();
    query.addEventListener?.("change", close);
    return () => query.removeEventListener?.("change", close);
  }, [sheet]);

  const locked = new Set(lockedFeatures);
  const activeKey = resolveShellActiveKey(pathname, search, workspaceBasePath, boardNavKeys);
  const settledTab = bottomTabForNavKey(activeKey);
  const activeTab = pendingTab && pendingTab.from === location ? pendingTab.tab : settledTab;

  const workSections = bottomWorkSheetSections(userTabs, dismissedSources);
  const moreSections = bottomMoreSheetSections(dismissedSources);

  const itemBadge = (item: NavItem): { approvals: number | null; notify: BadgeState | null } => {
    const raw = item.badgeKey ? badges?.[item.badgeKey] : undefined;
    const approvals = typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? raw : null;
    const isLocked = item.feature ? locked.has(item.feature) : false;
    const notify = approvals === null && !isLocked ? notifyBadges?.[item.key] ?? null : null;
    return { approvals, notify: notify && notify.kind !== "none" ? notify : null };
  };
  const sectionsHaveBadge = (sections: readonly BottomSheetSection[]) =>
    sections.some(({ items }) => items.some((item) => {
      const { approvals, notify } = itemBadge(item);
      return approvals !== null || notify !== null;
    }));

  const hrefFor = (item: NavItem) =>
    workspaceHref(workspaceBasePath, directBoardHref(item.key, boardNavKeys) ?? item.href!);
  const homeItem = NAV_ITEMS.find((item) => item.key === BOTTOM_HOME_KEY)!;
  const alertsItem = NAV_ITEMS.find((item) => item.key === BOTTOM_ALERTS_KEY)!;
  const alertsBadge = notifyBadges?.[BOTTOM_ALERTS_KEY];

  const navigateFromSheet = (tab: BottomTabKey) => {
    setPendingTab({ tab, from: location });
    setSheet(null);
  };

  return (
    <>
      <nav
        aria-label="아래 메뉴"
        data-mw-bottom-nav=""
        data-keyboard-open={keyboardOpen ? "" : undefined}
        className="mw-bottom-nav md:hidden"
      >
        <ul className="flex items-stretch" style={{ height: "var(--mw-bottom-nav-bar-h)", paddingInline: "var(--sp-1)" }}>
          <li className="flex min-w-0 flex-1">
            <Link
              href={hrefFor(homeItem)}
              data-bottom-tab="home"
              aria-current={activeTab === "home" ? "page" : undefined}
              onClick={(event) => { if (isPlainClick(event)) setPendingTab({ tab: "home", from: location }); }}
              className={TAB_CLASS}
            >
              <TabFace icon="home" label="홈" active={activeTab === "home"} />
              <span className="absolute" style={{ top: "var(--sp-1)", right: "var(--sp-1)" }}><NavPending onSettled={settle} /></span>
            </Link>
          </li>
          <li className="flex min-w-0 flex-1">
            <Link
              href={hrefFor(alertsItem)}
              data-bottom-tab="alerts"
              aria-current={activeTab === "alerts" ? "page" : undefined}
              onClick={(event) => { if (isPlainClick(event)) setPendingTab({ tab: "alerts", from: location }); }}
              className={TAB_CLASS}
            >
              <TabFace
                icon="bell"
                label="알림"
                active={activeTab === "alerts"}
                badge={alertsBadge && alertsBadge.kind !== "none" ? <Badge state={alertsBadge} label="알림" /> : null}
              />
              <span className="absolute" style={{ top: "var(--sp-1)", right: "var(--sp-1)" }}><NavPending onSettled={settle} /></span>
            </Link>
          </li>
          <li className="flex min-w-0 flex-1">
            <button
              type="button"
              data-bottom-tab="work"
              aria-haspopup="dialog"
              aria-expanded={sheet === "work"}
              aria-current={activeTab === "work" ? "page" : undefined}
              onClick={() => setSheet("work")}
              className={TAB_CLASS}
            >
              <TabFace icon="work" label="업무" active={activeTab === "work"} dot={sectionsHaveBadge(workSections)} />
            </button>
          </li>
          <li className="flex min-w-0 flex-1">
            <button
              type="button"
              data-bottom-tab="search"
              aria-haspopup="dialog"
              onClick={() => openGlobalSearch()}
              className={TAB_CLASS}
            >
              <TabFace icon="search" label="찾기" active={false} />
            </button>
          </li>
          <li className="flex min-w-0 flex-1">
            <button
              type="button"
              data-bottom-tab="more"
              aria-haspopup="dialog"
              aria-expanded={sheet === "more"}
              aria-current={activeTab === "more" ? "page" : undefined}
              onClick={() => setSheet("more")}
              className={TAB_CLASS}
            >
              <TabFace icon="more" label="더보기" active={activeTab === "more"} dot={sectionsHaveBadge(moreSections)} />
            </button>
          </li>
        </ul>
      </nav>

      {sheet ? (
        <NavSheet kind={sheet} title={sheet === "work" ? "업무" : "더보기"} onClose={() => setSheet(null)}>
          {(sheet === "work" ? workSections : moreSections).map((entry) => {
            const list = (
              <ul className="flex flex-col" aria-label={`${entry.label} 목록`}>
                {entry.items.map((item) => (
                  <li key={item.key}>
                    <SheetItem
                      item={item}
                      href={item.href ? hrefFor(item) : undefined}
                      active={item.key === activeKey}
                      isLocked={item.feature ? locked.has(item.feature) : false}
                      badge={itemBadge(item)}
                      onNavigate={() => navigateFromSheet(sheet)}
                    />
                  </li>
                ))}
              </ul>
            );
            return entry.collapsed ? (
              <details key={entry.key} data-bottom-sheet-section={entry.key} className="border-t" style={{ borderColor: "var(--mw-line)" }}>
                <summary className={`${SECTION_HEAD_CLASS} flex min-h-11 cursor-pointer items-center`} style={SECTION_HEAD_STYLE}>
                  {entry.label}
                </summary>
                {list}
              </details>
            ) : (
              <section key={entry.key} data-bottom-sheet-section={entry.key} aria-labelledby={`bottom-sheet-${entry.key}`}>
                <h3 id={`bottom-sheet-${entry.key}`} className={SECTION_HEAD_CLASS} style={SECTION_HEAD_STYLE}>
                  {entry.label}
                </h3>
                {list}
              </section>
            );
          })}
        </NavSheet>
      ) : null}
    </>
  );
}

const TAB_CLASS =
  "relative flex w-full min-w-11 flex-col items-center justify-center rounded-[var(--mw-r-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--mw-primary)]";
const SECTION_HEAD_CLASS = "font-semibold";
const SECTION_HEAD_STYLE: CSSProperties = {
  color: "var(--mw-sub)",
  fontSize: "var(--fs-11)",
  padding: "var(--sp-3) var(--sp-3) var(--sp-1)",
};

function TabFace({ icon, label, active, badge, dot }: { icon: IconName; label: string; active: boolean; badge?: ReactNode; dot?: boolean }) {
  return (
    <>
      <span
        aria-hidden="true"
        className="relative grid place-items-center rounded-full"
        style={{
          width: "var(--sp-10)",
          height: "1.75rem",
          ...(active
            ? { background: "var(--mw-nav-active-bg, var(--mw-record))", color: "var(--mw-nav-active-fg, var(--mw-on-accent))" }
            : { color: "var(--mw-sub)" }),
        }}
      >
        <Icon name={icon} />
        {dot ? (
          <span
            data-bottom-tab-dot=""
            className="absolute rounded-full"
            style={{ top: "calc(var(--sp-1) / 2)", right: "var(--sp-1)", width: "var(--sp-2)", height: "var(--sp-2)", background: "var(--mw-people)" }}
          />
        ) : null}
      </span>
      {badge ? <span className="absolute" style={{ top: "calc(var(--sp-1) / 2)", left: "calc(50% + var(--sp-1))" }}>{badge}</span> : null}
      <span
        className={active ? "font-semibold" : undefined}
        style={{ fontSize: "var(--fs-11)", color: active ? "var(--mw-fg)" : "var(--mw-sub)", marginTop: "calc(var(--sp-1) / 2)" }}
      >
        {label}
        {dot ? <span className="sr-only"> · 확인할 항목 있음</span> : null}
      </span>
    </>
  );
}

function NavSheet({ kind, title, onClose, children }: { kind: SheetKind; title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  return (
    <BoardModalLayer labelledBy={titleId} onClose={onClose} layerClassName="items-end justify-center">
      <div
        data-bottom-nav-sheet={kind}
        className="mw-bottom-sheet flex w-full flex-col overflow-hidden rounded-t-xl shadow-xl"
        style={{
          maxHeight: "85dvh",
          background: "var(--mw-card)",
          color: "var(--mw-fg)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <div className="flex items-center justify-between border-b" style={{ borderColor: "var(--mw-line)", padding: "var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-4)" }}>
          <h2 id={titleId} className="font-semibold" style={{ fontSize: "var(--fs-16)" }}>{title}</h2>
          <button
            type="button"
            aria-label={`${title} 닫기`}
            onClick={onClose}
            className="grid size-11 place-items-center rounded-[var(--mw-r-2)] hover:bg-[var(--mw-bg)] focus-visible:outline-2 focus-visible:outline-[var(--mw-primary)]"
            style={{ color: "var(--mw-sub)" }}
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" style={{ width: 16, height: 16 }}>
              <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ padding: "0 var(--sp-2) var(--sp-3)" }}>
          {children}
        </div>
      </div>
    </BoardModalLayer>
  );
}

function SheetItem({
  item,
  href,
  active,
  isLocked,
  badge,
  onNavigate,
}: {
  item: NavItem;
  href: string | undefined;
  active: boolean;
  isLocked: boolean;
  badge: { approvals: number | null; notify: BadgeState | null };
  onNavigate: () => void;
}) {
  const unavailable = !href;
  const isActive = active && !isLocked && !unavailable;
  const baseStyle: CSSProperties = {
    gap: "var(--sp-3)",
    minHeight: "2.75rem",
    borderRadius: "var(--mw-r-3)",
    paddingInline: "var(--sp-3)",
    fontSize: "var(--fs-14)",
  };
  const inner = (
    <>
      <span
        aria-hidden="true"
        className="inline-flex shrink-0"
        style={{ color: isActive ? "var(--mw-nav-active-fg, var(--mw-on-accent))" : "var(--mw-sub)" }}
      >
        {item.tabIcon ? <TabIcon name={item.tabIcon} size={18} /> : <Icon name={item.icon} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {badge.approvals !== null ? (
        <span
          className="font-bold"
          aria-label={`승인 대기 ${badge.approvals}건`}
          style={{
            background: "var(--mw-tint-coral)",
            color: "var(--mw-people)",
            borderRadius: "var(--mw-r-1)",
            paddingBlock: "var(--sp-1)",
            paddingInline: "var(--sp-2)",
            fontSize: "var(--mw-shell-badge-fs)",
          }}
        >
          {badge.approvals > 99 ? "99+" : badge.approvals}
        </span>
      ) : badge.notify ? (
        <span className="flex items-center"><Badge state={badge.notify} label={item.label} /></span>
      ) : null}
      {isLocked ? (
        <span aria-label="이 조직에 켜져 있지 않은 기능입니다" style={{ color: "var(--mw-sub)" }}>
          <Icon name="lock" />
        </span>
      ) : unavailable ? (
        <span aria-label="담당 트랙에서 화면 준비 중" style={{ color: "var(--mw-sub)", fontSize: "var(--mw-shell-badge-fs)" }}>
          준비 중
        </span>
      ) : null}
    </>
  );

  if (unavailable) {
    return (
      <span
        data-nav-key={item.key}
        role="link"
        aria-disabled="true"
        tabIndex={0}
        onClick={(event) => event.preventDefault()}
        className="flex w-full cursor-not-allowed items-center"
        style={{ ...baseStyle, color: "var(--mw-sub)" }}
      >
        {inner}
      </span>
    );
  }

  return (
    <Link
      data-nav-key={item.key}
      href={href}
      aria-disabled={isLocked ? "true" : undefined}
      aria-current={isActive ? "page" : undefined}
      onClick={(event) => { if (isPlainClick(event)) onNavigate(); }}
      className={`flex w-full items-center focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--mw-primary)] ${isActive ? "mw-nav-active font-semibold" : "hover:bg-[var(--mw-bg)]"}`}
      style={
        isActive
          ? { ...baseStyle, background: "var(--mw-nav-active-bg, var(--mw-record))", color: "var(--mw-nav-active-fg, var(--mw-on-accent))" }
          : { ...baseStyle, color: isLocked ? "var(--mw-sub)" : "var(--mw-fg)" }
      }
    >
      {inner}
    </Link>
  );
}
