import Link from "next/link";
import { notFound } from "next/navigation";
import { applyAs, getSession } from "@/lib/auth/session";
import { getNoticesService, NOTICE_STATUS_LABEL } from "@/lib/notices";
import { NotFoundError } from "@/lib/boards";
import { NoticeCategoryBadge, PinnedBadge } from "@/components/notices/NoticeCategoryBadge";
import { NoticeStatusBadge } from "@/components/notices/NoticeStatusBadge";

/**
 * 공지 상세 (BBE-17).
 *
 * 알림센터 딥링크(`/notices/{id}`)가 도착하는 지면이다.
 * 열람 권한이 없는 공지는 서비스가 NotFoundError 를 던지므로 404 로 수렴한다 —
 * "권한 없음"과 "없음"을 구분해 알려주지 않는다(존재 여부 자체를 숨긴다).
 */
export default async function NoticeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ noticeId: string }>;
  searchParams: Promise<{ as?: string }>;
}) {
  const [{ noticeId }, sp] = await Promise.all([params, searchParams]);
  const ctx = applyAs(await getSession(), sp.as);

  let notice;
  try {
    notice = await getNoticesService().get(ctx, noticeId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  return (
    <article className="flex flex-col gap-6">
      <div>
        <Link href="/notices" className="text-sm text-zinc-500 hover:underline">
          ← 공지사항 목록
        </Link>
      </div>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <PinnedBadge pinned={notice.pinned} />
          <NoticeStatusBadge status={notice.status} />
          <NoticeCategoryBadge categoryId={notice.categoryId} label={notice.categoryLabel} />
          {notice.audienceLabel && (
            <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {notice.audienceLabel}
            </span>
          )}
        </div>
        <h1 className="text-xl font-semibold">{notice.title}</h1>
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
          <div className="flex gap-1">
            <dt>게시일</dt>
            <dd>{notice.publishedAt ?? "—"}</dd>
          </div>
          <div className="flex gap-1">
            <dt>종료일</dt>
            <dd>{notice.endedAt ?? "무기한"}</dd>
          </div>
          <div className="flex gap-1">
            <dt>상태</dt>
            <dd>{NOTICE_STATUS_LABEL[notice.status]}</dd>
          </div>
        </dl>
      </header>

      {notice.body === "" ? (
        <p className="rounded border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          본문이 없는 공지입니다.
        </p>
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">
          {notice.body}
        </p>
      )}
    </article>
  );
}
