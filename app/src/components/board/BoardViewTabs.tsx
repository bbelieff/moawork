import Link from "next/link";

/**
 * 보기 전환 — 탭 머리말 둘째 줄의 밑줄 탭(#845 개선안 · 2026-10-08).
 * 지금 보기는 진한 글자 + 2px 밑줄, 나머지는 회색 글자. 주소를 바꾸는 이동이므로 링크와 aria-current 를 쓴다.
 * 훅이 없어 서버 화면에서 바로 그린다.
 */

export type BoardViewKey = "table" | "kanban";

function ViewIcon({ view }: { view: BoardViewKey }) {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flex: "none" }}>
      {view === "kanban" ? (
        <>
          <rect x="3" y="4" width="5" height="16" rx="1.5" />
          <rect x="10" y="4" width="5" height="10" rx="1.5" />
          <rect x="17" y="4" width="4" height="13" rx="1.5" />
        </>
      ) : (
        <path d="M3 6h18M3 12h18M3 18h18" />
      )}
    </svg>
  );
}

export function BoardViewTabs({
  tabs,
}: {
  tabs: readonly { view: BoardViewKey; label: string; href: string; active: boolean }[];
}) {
  return (
    <nav aria-label="보기 전환" className="flex shrink-0 items-end gap-5">
      {tabs.map((tab) => (
        <Link
          key={tab.view}
          href={tab.href}
          data-board-view-tab={tab.view}
          aria-current={tab.active ? "page" : undefined}
          className={`flex h-9 items-center gap-1.5 border-b-2 text-[length:var(--fs-13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mw-primary ${
            tab.active
              ? "border-[color:var(--mw-fg)] font-semibold text-mw-fg"
              : "border-transparent text-mw-sub hover:text-mw-fg"
          }`}
        >
          <ViewIcon view={tab.view} />
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
