"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  WorkspaceSwitcher,
  type WorkspaceSwitcherProps,
} from "@/components/workspace/WorkspaceSwitcher";
import { NAV_ITEMS, type NavBadgeKey } from "./nav-items";

// 사이드바 메뉴 목록 — 활성 표시를 위해 클라이언트 컴포넌트.
// 잠금/미구현 판정은 서버(레이아웃)에서 내려받는다(엔타이틀먼트는 서버 진실).

type Props = {
  /** 서버에서 계산한 "잠긴 기능키" 집합 — 이 기능을 요구하는 메뉴는 자물쇠. */
  lockedFeatures: string[];
  /** 서버에서 범위 검증을 마친 배지만 받는다. 값이 없으면 숫자를 만들지 않는다. */
  badges?: Partial<Record<NavBadgeKey, number>>;
  workspaceSwitcher?: Omit<WorkspaceSwitcherProps, "onNavigate">;
};

export function SidebarNav({ lockedFeatures, badges, workspaceSwitcher }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const locked = new Set(lockedFeatures);

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
      <nav className="hidden flex-col gap-px md:flex" aria-label="주요 메뉴">
      {NAV_ITEMS.map((item) => {
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

        const inner = (
          <>
            <span className="w-[18px] text-center">{item.icon}</span>
            <span>{item.label}</span>
            {visibleBadge !== null ? (
              <span
                className="ml-auto rounded-lg px-[7px] py-[2px] text-[10.5px] font-bold"
                aria-label={`승인 대기 ${visibleBadge}건`}
                style={{
                  background: "var(--mw-tint-coral)",
                  color: "var(--mw-people)",
                }}
              >
                {visibleBadge > 99 ? "99+" : visibleBadge}
              </span>
            ) : null}
            {isLocked ? (
              <span
                className="ml-auto text-[11px]"
                style={{ color: "var(--mw-sub)" }}
                title="이 조직에 켜져 있지 않은 기능입니다"
              >
                🔒
              </span>
            ) : !item.href ? (
              <span
                className="ml-auto text-[10.5px]"
                style={{ color: "var(--mw-sub)" }}
                title="담당 트랙에서 화면 준비 중"
              >
                준비 중
              </span>
            ) : null}
          </>
        );

        const base =
          "flex items-center gap-2.5 rounded-[10px] px-3 py-[9px] text-[13.5px]";

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
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                }
              }}
              className={`${base} cursor-not-allowed`}
              style={{ color: "var(--mw-sub)" }}
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
                ? {
                    background: "var(--mw-record)",
                    color: "var(--mw-on-accent)",
                  }
                : { color: isLocked ? "var(--mw-sub)" : "var(--mw-fg)" }
            }
          >
            {inner}
          </Link>
        );
      })}
      </nav>
    </>
  );
}
