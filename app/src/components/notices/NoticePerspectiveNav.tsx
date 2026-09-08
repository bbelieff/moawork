import Link from "next/link";
import type { NoticePerspective } from "@/lib/notices/perspectives";

const ITEMS: readonly { key: NoticePerspective | "department" | "for-me"; label: string; available: boolean }[] = [
  { key: "all", label: "전체", available: true },
  { key: "department", label: "내 부서", available: false },
  { key: "for-me", label: "나에게", available: false },
  { key: "authored", label: "내가 작성", available: true },
];

export function NoticePerspectiveNav({ baseHref, active, as }: { baseHref: string; active: NoticePerspective; as?: string }) {
  return (
    <nav aria-label="공지 보기" className="flex flex-wrap items-center gap-2 rounded-xl border border-mw-line bg-mw-card p-2">
      {ITEMS.map((item) => item.available ? (
        <Link
          key={item.key}
          href={`${baseHref}?${new URLSearchParams({ ...(as ? { as } : {}), noticeView: item.key }).toString()}`}
          aria-current={active === item.key ? "page" : undefined}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${active === item.key ? "bg-mw-tint-blue text-mw-record" : "text-mw-sub hover:text-mw-fg"}`}
        >
          {item.label}
        </Link>
      ) : (
        <span key={item.key} aria-disabled="true" title="대상별 보기는 후속 데이터 계약 정합화가 필요합니다" className="rounded-full border border-dashed border-mw-line px-3 py-1.5 text-xs text-mw-sub opacity-70">
          {item.label} · 준비 중
        </span>
      ))}
      <span className="ml-auto text-[0.68rem] text-mw-sub">공지 제목을 누르면 canonical 보드 상세가 열립니다.</span>
    </nav>
  );
}
