"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./nav-items";

// 사이드바 메뉴 목록 — 활성 표시를 위해 클라이언트 컴포넌트.
// 잠금/미구현 판정은 서버(레이아웃)에서 내려받는다(엔타이틀먼트는 서버 진실).

type Props = {
  /** 서버에서 계산한 "잠긴 기능키" 집합 — 이 기능을 요구하는 메뉴는 자물쇠. */
  lockedFeatures: string[];
  /** 배지(예: 신규업체 건수). key → 표시값. */
  badges?: Record<string, number>;
};

export function SidebarNav({ lockedFeatures, badges }: Props) {
  const pathname = usePathname();
  const locked = new Set(lockedFeatures);

  return (
    <nav className="flex flex-col gap-px">
      {NAV_ITEMS.map((item) => {
        const isLocked = item.feature ? locked.has(item.feature) : false;
        // 라우트가 없거나 잠긴 메뉴는 링크하지 않는다.
        const disabled = !item.href || isLocked;
        const active =
          !disabled &&
          (item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href!));

        const badge = badges?.[item.key];

        const inner = (
          <>
            <span className="w-[18px] text-center">{item.icon}</span>
            <span>{item.label}</span>
            {badge !== undefined && !isLocked ? (
              <span
                className="ml-auto rounded-lg px-[7px] py-[2px] text-[10.5px] font-bold"
                style={{
                  background: "var(--mw-tint-coral)",
                  color: "var(--mw-people)",
                }}
              >
                {badge}
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

        if (disabled) {
          return (
            <span
              key={item.key}
              aria-disabled="true"
              className={`${base} cursor-default`}
              style={{ color: "var(--mw-sub)" }}
            >
              {inner}
            </span>
          );
        }

        return (
          <Link
            key={item.key}
            href={item.href!}
            aria-current={active ? "page" : undefined}
            className={`${base} ${active ? "font-semibold" : "hover:bg-[var(--mw-bg)]"}`}
            style={
              active
                ? {
                    background: "var(--mw-record)",
                    color: "var(--mw-on-accent)",
                  }
                : { color: "var(--mw-fg)" }
            }
          >
            {inner}
          </Link>
        );
      })}
    </nav>
  );
}
