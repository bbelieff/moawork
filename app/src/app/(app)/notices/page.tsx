import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { applyAs, getSession } from "@/lib/auth/session";
import {
  NoticesService,
  NOTICE_AUDIENCE_OPTIONS,
  NOTICE_CATEGORY_OPTIONS,
  resolveExistingNoticeBoard,
  todayKst,
} from "@/lib/notices";
import { BoardsService } from "@/lib/boards/service";
import { SupabaseBoardsRepo } from "@/lib/repo/supabase/boardsRepo";
import { createClient } from "@/lib/supabase/server";
import { canUseLocalSeedFallback } from "@/lib/supabase/local-fallback";
import { isManager } from "@/lib/auth/roles";
import { ensureNoticeTabAtomic } from "@/lib/notices/atomic";
import { loadVerifiedWorkspaceBasePath } from "@/lib/auth/workspace-href-server";
import { workspaceHref } from "@/components/shell/workspace-href";
import { NoticeCategoryBadge, PinnedBadge } from "@/components/notices/NoticeCategoryBadge";
import { NoticeStatusBadge } from "@/components/notices/NoticeStatusBadge";
import {
  createNoticeAction,
  deleteNoticeAction,
  endNoticeAction,
  resumeNoticeAction,
  toggleNoticePinAction,
  updateNoticeAction,
} from "./actions";

/**
 * 공지사항 보드 (T04 · core.notice).
 * 저장은 003 보드 엔진(boards/items/item_values) — 전용 테이블 없음(ADR-0002).
 * 목록 정렬: 상단고정 → 게시일 최신순.
 */
/**
 * 워크스페이스 DB 미연결 — 오류가 아니라 «아직 연결 안 됨» 이다.
 * 빈 공지 목록으로 위장하지 않는다(0건과 «못 읽었다» 는 다른 사실이다).
 */
function NoticesNotConnected() {
  return (
    <section
      className="rounded-xl border border-mw-line bg-mw-card p-5"
      aria-labelledby="notice-entry-title"
      role="status"
      data-testid="notice-not-connected"
    >
      <h1 id="notice-entry-title" className="text-lg font-semibold text-mw-fg">
        워크스페이스 데이터에 아직 연결되지 않았습니다
      </h1>
      <p className="mt-2 text-sm text-mw-sub">
        공지사항은 워크스페이스 데이터베이스에서 옵니다. 연결되면 여기에 목록이 바로 나옵니다.
      </p>
    </section>
  );
}

export default async function NoticesPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const sp = await searchParams;
  const ctx = applyAs(await getSession(), sp.as);
  // One request-bound authenticated client owns both the product-tab lookup
  // and the legacy notice fallback. Production never crosses an in-memory repo.
  //
  // ★ 환경변수가 없으면(로컬 시드 모드) `createClient()` 가 곧바로 throw 해서 이 화면 전체가
  // 500 이었다. 여기서 먼저 갈라 «아직 연결 안 됨» 을 보여준다 — 오류가 아니라 상태다.
  // 로컬 어댑터로 우회하지 않는다: 페이지에서 로컬 repo 를 부르는 것은 프로덕션 경계 정책이
  // 막는 일이다(scripts/check-production-repo-boundaries.mjs).
  if (canUseLocalSeedFallback()) return <NoticesNotConnected />;

  const client = await createClient();
  const workspaceBasePath = await loadVerifiedWorkspaceBasePath();
  const repo = new SupabaseBoardsRepo(client);
  let noticeEntryState: "conflict" | "unavailable" | null = null;
  try {
    const productBoard = await resolveExistingNoticeBoard(ctx, repo);
    if (productBoard.kind === "ready") {
      const query = sp.as ? `?as=${encodeURIComponent(sp.as)}` : "";
      redirect(workspaceHref(workspaceBasePath, `/boards/${encodeURIComponent(productBoard.boardId)}${query}`));
    }
    if (productBoard.kind === "conflict") {
      noticeEntryState = "conflict";
    } else {
      // D76 default tabs are guaranteed, not installed by a user-facing step.
      // Reconciliation is idempotent by the stable product source and uses the
      // same authenticated Supabase adapter as the lookup above.
      const boardId = await ensureNoticeTabAtomic(ctx, client);
      const query = sp.as ? `?as=${encodeURIComponent(sp.as)}` : "";
      redirect(workspaceHref(workspaceBasePath, `/boards/${encodeURIComponent(boardId)}${query}`));
    }
  } catch (error) {
    // Preserve redirects and other Next.js control-flow errors.
    unstable_rethrow(error);
    noticeEntryState = "unavailable";
  }
  if (noticeEntryState === "conflict") {
    return (
      <section className="rounded-xl border border-mw-line bg-mw-card p-5" aria-labelledby="notice-entry-title">
        <h1 id="notice-entry-title" className="text-lg font-semibold text-mw-fg">
          공지사항 보드를 하나로 확인하지 못했습니다
        </h1>
        <p className="mt-2 text-sm text-mw-sub">회사 관리자에게 보드 구성을 확인해 달라고 요청해 주세요.</p>
      </section>
    );
  }
  if (noticeEntryState === "unavailable") {
    return (
      <section
        className="rounded-xl border border-red-200 bg-mw-card p-5"
        aria-labelledby="notice-entry-title"
        data-testid="notice-load-error"
      >
        <h1 id="notice-entry-title" className="text-lg font-semibold text-mw-fg">
          공지사항을 불러오지 못했습니다
        </h1>
        <p className="mt-2 text-sm text-mw-sub">잠시 후 다시 시도해 주세요. 문제가 계속되면 회사 관리자에게 알려 주세요.</p>
      </section>
    );
  }

  // Existing organizations can keep consuming their pre-default-tab notice
  // board until reconciliation installs the product-owned source.
  const notices = await new NoticesService(new BoardsService(repo), repo).list(ctx);

  // 공지 작성/수정은 관리자(owner/admin)만. member 는 읽기 전용.
  // (UI 를 숨기는 것과 별개로 서비스가 서버에서 같은 검사를 한다.)
  const canWrite = isManager(ctx.role);

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
                <span className="text-zinc-500">열람 대상</span>
                <select
                  name="audienceId"
                  defaultValue=""
                  className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="">구성원 전체</option>
                  {NOTICE_AUDIENCE_OPTIONS.map((o) => (
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
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-zinc-500">종료일 (비우면 무기한)</span>
                <input
                  type="date"
                  name="endedAt"
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
          등록된 공지가 없습니다.
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
                <NoticeStatusBadge status={n.status} />
                <NoticeCategoryBadge categoryId={n.categoryId} label={n.categoryLabel} />
                <Link
                  href={workspaceHref(workspaceBasePath, `/notices/${n.id}`)}
                  className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                >
                  {n.title}
                </Link>
                {canWrite && n.audienceLabel && (
                  <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {n.audienceLabel}
                  </span>
                )}
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

                  <form action={n.status === "ended" ? resumeNoticeAction : endNoticeAction}>
                    <input type="hidden" name="noticeId" value={n.id} />
                    <button
                      type="submit"
                      className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                    >
                      {n.status === "ended" ? "게시 재개" : "게시 종료"}
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
                        <select
                          name="audienceId"
                          defaultValue={n.audienceId ?? ""}
                          aria-label="열람 대상"
                          className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        >
                          <option value="">구성원 전체</option>
                          {NOTICE_AUDIENCE_OPTIONS.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        <input
                          type="date"
                          name="publishedAt"
                          aria-label="게시일"
                          defaultValue={n.publishedAt ?? ""}
                          className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        />
                        <input
                          type="date"
                          name="endedAt"
                          aria-label="종료일"
                          defaultValue={n.endedAt ?? ""}
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
