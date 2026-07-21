import Link from "next/link";
import type { Notice } from "@/lib/notices";
import { NoticeCategoryBadge, PinnedBadge } from "@/components/notices/NoticeCategoryBadge";

/**
 * 홈 대시보드 "최근 공지" 위젯 (T04).
 * 목록은 상단고정 → 게시일 최신순(NoticesService.list 가 정렬). 여기서는 렌더만 한다.
 */
export function RecentNotices({
  notices,
  scopeLimited,
}: {
  notices: Notice[];
  /** member+assigned 는 미배정 공지를 못 본다(003 items RLS) — 빈 목록의 사유를 구분해 표시. */
  scopeLimited: boolean;
}) {
  if (notices.length === 0) {
    return (
      <p className="p-3 text-sm text-zinc-400">
        {scopeLimited
          ? "담당범위(assigned) 계정에는 조직 공지가 보이지 않습니다."
          : "등록된 공지가 없습니다."}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {notices.map((n) => (
        <li key={n.id}>
          <Link
            href={`/notices#${n.id}`}
            className="flex items-center gap-2 px-1 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            <PinnedBadge pinned={n.pinned} />
            <NoticeCategoryBadge categoryId={n.categoryId} label={n.categoryLabel} />
            <span className="min-w-0 flex-1 truncate">{n.title}</span>
            <span className="shrink-0 text-xs text-zinc-400">{n.publishedAt ?? "—"}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
