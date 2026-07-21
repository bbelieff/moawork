import Link from "next/link";
import { applyAs, getSession } from "@/lib/auth/session";
import { getNoticesService, NOTICE_CATEGORY_OPTIONS, todayKst } from "@/lib/notices";
import { isManager } from "@/lib/auth/roles";
import { NoticeCategoryBadge, PinnedBadge } from "@/components/notices/NoticeCategoryBadge";
import {
  createNoticeAction,
  deleteNoticeAction,
  toggleNoticePinAction,
  updateNoticeAction,
} from "./actions";

/**
 * 공지사항 보드 (T04 · core.notice).
 * 저장은 003 보드 엔진(boards/items/item_values) — 전용 테이블 없음(ADR-0002).
 * 목록 정렬: 상단고정 → 게시일 최신순.
 */
export default async function NoticesPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const sp = await searchParams;
  const ctx = applyAs(await getSession(), sp.as);
  const notices = getNoticesService().list(ctx);

  // 공지 작성/수정은 관리자(owner/admin)만. member 는 읽기 전용.
  const canWrite = isManager(ctx.role);
  const scopeLimited = ctx.scope === "assigned";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">📢 공지사항</h1>
          <p className="text-sm text-zinc-500">
            조직 전체 공지 — 상단고정이 먼저 보입니다. ({ctx.role}/{ctx.scope})
          </p>
        </div>
        <Link href="/" className="text-sm text-zinc-500 hover:underline">
          ← 대시보드
        </Link>
      </div>

      {canWrite && (
        <details className="rounded border border-zinc-200 dark:border-zinc-800">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
            + 새 공지
          </summary>
          <form
            action={createNoticeAction}
            className="flex flex-col gap-3 border-t border-zinc-200 p-3 dark:border-zinc-800"
          >
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-zinc-500">제목</span>
              <input
                name="title"
                required
                maxLength={200}
                placeholder="예: 7월 상담 일정 안내"
                className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-zinc-500">본문</span>
              <textarea
                name="body"
                rows={4}
                className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-zinc-500">분류</span>
                <select
                  name="categoryId"
                  defaultValue=""
                  className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="">미지정</option>
                  {NOTICE_CATEGORY_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-zinc-500">게시일</span>
                <input
                  type="date"
                  name="publishedAt"
                  defaultValue={todayKst()}
                  className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                <input type="checkbox" name="pinned" />
                상단고정
              </label>
              <button
                type="submit"
                className="ml-auto rounded bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
              >
                등록
              </button>
            </div>
          </form>
        </details>
      )}

      {notices.length === 0 ? (
        <p className="rounded border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          {scopeLimited
            ? "담당범위(assigned) 계정에는 조직 공지가 보이지 않습니다 — 003 items 정책 제약(기획 판정 대기)."
            : "등록된 공지가 없습니다."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notices.map((n) => (
            <li
              key={n.id}
              id={n.id}
              className="rounded border border-zinc-200 dark:border-zinc-800"
            >
              <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                <PinnedBadge pinned={n.pinned} />
                <NoticeCategoryBadge categoryId={n.categoryId} label={n.categoryLabel} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{n.title}</span>
                <span className="shrink-0 text-xs text-zinc-400">{n.publishedAt ?? "—"}</span>
              </div>

              {n.body !== "" && (
                <p className="whitespace-pre-wrap border-t border-zinc-100 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                  {n.body}
                </p>
              )}

              {canWrite && (
                <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
                  <form action={toggleNoticePinAction}>
                    <input type="hidden" name="noticeId" value={n.id} />
                    <input type="hidden" name="pinned" value={String(n.pinned)} />
                    <button
                      type="submit"
                      className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                    >
                      {n.pinned ? "고정 해제" : "상단고정"}
                    </button>
                  </form>

                  <details className="ml-auto">
                    <summary className="cursor-pointer select-none rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700">
                      수정
                    </summary>
                    <form
                      action={updateNoticeAction}
                      className="mt-2 flex flex-col gap-2 rounded border border-zinc-200 p-2 dark:border-zinc-800"
                    >
                      <input type="hidden" name="noticeId" value={n.id} />
                      <input
                        name="title"
                        required
                        defaultValue={n.title}
                        maxLength={200}
                        className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                      />
                      <textarea
                        name="body"
                        rows={3}
                        defaultValue={n.body}
                        className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          name="categoryId"
                          defaultValue={n.categoryId ?? ""}
                          className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        >
                          <option value="">미지정</option>
                          {NOTICE_CATEGORY_OPTIONS.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        <input
                          type="date"
                          name="publishedAt"
                          defaultValue={n.publishedAt ?? ""}
                          className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        />
                        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                          <input type="checkbox" name="pinned" defaultChecked={n.pinned} />
                          상단고정
                        </label>
                        <button
                          type="submit"
                          className="ml-auto rounded bg-zinc-900 px-3 py-1 text-xs text-white dark:bg-zinc-100 dark:text-zinc-900"
                        >
                          저장
                        </button>
                      </div>
                    </form>
                  </details>

                  <form action={deleteNoticeAction}>
                    <input type="hidden" name="noticeId" value={n.id} />
                    <button
                      type="submit"
                      className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
                    >
                      삭제
                    </button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
