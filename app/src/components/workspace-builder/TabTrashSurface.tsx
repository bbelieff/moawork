import Link from "next/link";
import { Suspense } from "react";
import {
  BOARD_TRASH_RETENTION_DAYS,
  type Board,
  type BoardTrashImpact,
  type DefaultTabDismissal,
} from "@/lib/boards/types";
import {
  purgeBoardAction,
  reinstallDefaultTabAction,
  restoreBoardAction,
} from "@/app/(app)/settings/workspace-builder/tab-actions";
import { noticeLive, noticeRole } from "@/lib/ui/result-notice";

/**
 * #849 탭 휴지통 화면 조각.
 *
 * - BoardTrashSection: 보드 설정 › «탭 삭제» (지울 내용 개수 + 휴지통으로 삭제)
 * - TabTrashSurface: 탭 관리 › «탭 목록·휴지통» (탭 목록 · 휴지통 · 지운 기본 탭)
 *
 * 서버 컴포넌트 + `<details>` + 서버 액션 — 클라이언트 JS 없이 동작한다(NewBoardInline 과 같은 방식).
 */

const DAY_MS = 86_400_000;
const DEFAULT_TAB_PREFIX = "core.default-tab/";
// en-CA 는 YYYY-MM-DD 로 찍는다. 날짜는 한국 시간 기준.
const KST_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function kstDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "—" : KST_DATE.format(date);
}

/** 휴지통에 들어간 시각 → 완전히 지워지는 날과 남은 날 수. */
export function trashCountdown(deletedAt: string | null | undefined, now: Date): { daysLeft: number; purgeOn: string; label: string } {
  const deleted = deletedAt ? Date.parse(deletedAt) : Number.NaN;
  if (Number.isNaN(deleted)) return { daysLeft: 0, purgeOn: "—", label: "—" };
  const purgeAt = new Date(deleted + BOARD_TRASH_RETENTION_DAYS * DAY_MS);
  const daysLeft = Math.max(0, Math.ceil((purgeAt.getTime() - now.getTime()) / DAY_MS));
  const purgeOn = kstDate(purgeAt);
  return { daysLeft, purgeOn, label: daysLeft > 0 ? `${daysLeft}일 남음 (${purgeOn})` : `오늘 지워져요 (${purgeOn})` };
}

/** ‘이름’을/를 — 마지막 글자 받침으로 고른다. 한글이 아니면 을(를). */
export function quotedObject(name: string): string {
  const code = (name.trim().at(-1) ?? "").charCodeAt(0) - 0xac00;
  if (!(code >= 0 && code <= 11171)) return `‘${name}’을(를)`;
  return `‘${name}’${code % 28 === 0 ? "를" : "을"}`;
}

export function formatTrashImpact(impact: BoardTrashImpact): string {
  const parts: Array<[string, number]> = [
    ["아이템", impact.groups],
    ["행", impact.rows],
    ["메모", impact.memos],
    ["첨부 파일", impact.files],
    ["저장된 보기", impact.views],
    ["자동화 규칙", impact.automations],
    ["문자 규칙", impact.messaging],
  ];
  return parts.map(([label, count]) => `${label} ${(Number(count) || 0).toLocaleString("ko-KR")}`).join(" · ");
}

function isDefaultTabSource(source: string | null | undefined): boolean {
  return typeof source === "string" && source.startsWith(DEFAULT_TAB_PREFIX);
}

// ── 결과 안내 ────────────────────────────────────────────────────────────────

/** 서버 액션이 돌려보내는 오류 코드 — URL 에는 코드만 싣고 문장은 여기서 고른다. */
export const TAB_TRASH_ERRORS = {
  permission: "이 작업을 할 권한이 없어요. 대표에게 권한을 요청해 주세요.",
  unavailable: "권한을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  audit: "위험 작업 기록을 남기지 못해 실행하지 않았어요. 잠시 뒤 다시 시도해 주세요.",
  "already-installed": "같은 기본 탭이 이미 다시 설치돼 있어요. 휴지통의 탭은 완전 삭제할 수 있어요.",
  "not-in-trash": "휴지통에서 그 탭을 찾지 못했어요. 새로고침해서 목록을 다시 확인해 주세요.",
  "unknown-default-tab": "다시 설치할 기본 탭을 찾지 못했어요. 새로고침 후 다시 시도해 주세요.",
  "restore-failed": "탭을 되살리지 못했어요. 새로고침 후 다시 시도해 주세요.",
  "purge-failed": "탭을 완전히 지우지 못했어요. 새로고침 후 다시 시도해 주세요.",
  "reinstall-failed": "기본 탭을 다시 설치하지 못했어요. 새로고침 후 다시 시도해 주세요.",
} as const;
export type TabTrashErrorCode = keyof typeof TAB_TRASH_ERRORS;

export function isTabTrashErrorCode(value: unknown): value is TabTrashErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TAB_TRASH_ERRORS, value);
}

export type TabTrashParams = Readonly<{
  trashed?: string;
  restored?: string;
  purged?: string;
  reinstalled?: string;
  error?: string;
}>;

export type TabTrashNotice = Readonly<{ tone: "success" | "error"; message: string }>;

export type DefaultTabEntry = Readonly<{ source: string; name: string }>;

export function resolveTabTrashNotice(
  params: TabTrashParams,
  data: Readonly<{
    activeBoards: readonly Board[];
    trashedBoards: readonly Board[];
    defaultTabs: readonly DefaultTabEntry[];
    now: Date;
  }>,
): TabTrashNotice | null {
  if (isTabTrashErrorCode(params.error)) return { tone: "error", message: TAB_TRASH_ERRORS[params.error] };
  if (params.trashed) {
    const board = data.trashedBoards.find((candidate) => candidate.id === params.trashed);
    if (board) {
      const { purgeOn } = trashCountdown(board.deleted_at, data.now);
      return { tone: "success", message: `${quotedObject(board.name)} 휴지통으로 옮겼어요 · ${purgeOn}에 완전히 지워져요` };
    }
  }
  if (params.restored) {
    const board = data.activeBoards.find((candidate) => candidate.id === params.restored);
    if (board) return { tone: "success", message: `${quotedObject(board.name)} 되살렸어요. 멈췄던 문자·자동화 규칙도 다시 켜졌어요.` };
  }
  if (params.purged) return { tone: "success", message: "탭을 완전히 지웠어요." };
  if (params.reinstalled) {
    const tab = data.defaultTabs.find((candidate) => candidate.source === params.reinstalled);
    if (tab) return { tone: "success", message: `‘${tab.name}’ 기본 탭을 빈 탭으로 다시 설치했어요.` };
  }
  return null;
}

/** 다시 설치할 수 있는 지운 기본 탭 — 휴지통에 남아 있으면 «복구» 가 먼저라 빼고, 이미 있는 탭도 뺀다. */
export function reinstallableDefaultTabs(
  dismissals: readonly DefaultTabDismissal[],
  activeBoards: readonly Board[],
  trashedBoards: readonly Board[],
  defaultTabs: readonly DefaultTabEntry[],
): Array<DefaultTabEntry & { dismissedAt: string }> {
  const present = new Set([
    ...activeBoards.map((board) => board.source),
    ...trashedBoards.map((board) => board.trashed_source),
  ]);
  return dismissals.flatMap((dismissal) => {
    const tab = defaultTabs.find((candidate) => candidate.source === dismissal.source);
    return tab && !present.has(dismissal.source) ? [{ ...tab, dismissedAt: dismissal.dismissed_at }] : [];
  });
}

// ── 보드 설정 › 탭 삭제 ──────────────────────────────────────────────────────

export async function BoardTrashImpactSummary({ loadImpact }: Readonly<{ loadImpact: () => Promise<BoardTrashImpact> }>) {
  const impact = await loadImpact().catch(() => null);
  if (!impact) {
    return <p className="mt-1 text-xs text-mw-sub">지울 내용의 개수를 불러오지 못했어요. 삭제와 복구는 그대로 할 수 있어요.</p>;
  }
  return <p className="mt-1 text-xs font-medium text-mw-body" data-testid="board-trash-impact">{formatTrashImpact(impact)}</p>;
}

export function BoardTrashSection({
  boardId,
  boardName,
  deleteAction,
  loadImpact,
}: Readonly<{
  boardId: string;
  boardName: string;
  deleteAction: (formData: FormData) => Promise<void>;
  /** 렌더할 때 한 번 읽는다 — 보드 화면의 왕복 예산(BBE-214) 밖에서 스트리밍된다. */
  loadImpact: () => Promise<BoardTrashImpact>;
}>) {
  return (
    <section className="rounded-md border border-mw-error/40 p-3" aria-labelledby="danger-heading">
      <h2 id="danger-heading" className="font-semibold text-mw-error">탭 삭제</h2>
      <Suspense fallback={<p className="mt-1 text-xs text-mw-sub">지울 내용을 세는 중…</p>}>
        <BoardTrashImpactSummary loadImpact={loadImpact} />
      </Suspense>
      <p className="mt-2 rounded-md bg-mw-tint-blue px-2.5 py-2 text-xs leading-5 text-mw-body">
        삭제하면 바로 휴지통으로 옮겨져요. 사이드바에서 사라지고 문자·자동화 규칙은 멈춰요.
      </p>
      <p className="mt-1.5 rounded-md bg-mw-tint-amber px-2.5 py-2 text-xs leading-5 text-mw-body">
        {BOARD_TRASH_RETENTION_DAYS}일 안에는 탭 관리 › 휴지통에서 그대로 복구할 수 있어요. {BOARD_TRASH_RETENTION_DAYS}일이 지나면 완전히 지워져요.
      </p>
      <details className="group mt-3">
        <summary className="inline-flex cursor-pointer select-none list-none rounded-md border border-mw-error/40 px-3 py-1.5 text-xs font-semibold text-mw-error hover:bg-mw-tint-coral [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">이 탭 삭제</span>
          <span className="hidden group-open:inline">취소</span>
        </summary>
        <form action={deleteAction} className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-mw-error/40 bg-mw-tint-coral p-2.5">
          <input type="hidden" name="boardId" value={boardId} />
          <p className="min-w-0 flex-1 text-xs text-mw-fg">{quotedObject(boardName)} 휴지통으로 옮길까요?</p>
          <button type="submit" className="rounded-md bg-mw-error px-3 py-1.5 text-xs font-semibold text-mw-on-accent hover:opacity-90">
            휴지통으로 삭제
          </button>
        </form>
      </details>
    </section>
  );
}

// ── 탭 관리 › 탭 목록·휴지통 ─────────────────────────────────────────────────

const CARD = "rounded-md border border-mw-line bg-mw-card p-4";
const HEAD_CELL = "px-2 py-2 text-left text-xs font-semibold text-mw-sub";
const ROW = "block border-t border-mw-line py-2 sm:table-row sm:py-0";
const CELL = "block px-2 py-0.5 align-middle sm:table-cell sm:py-2.5";
const BADGE = "inline-flex items-center rounded-full px-2 py-0.5 text-[0.7rem] font-semibold";

function placeLabel(board: Board) {
  if (board.is_system) return <span className={`${BADGE} bg-mw-bg text-mw-sub`}>시스템 탭</span>;
  if (isDefaultTabSource(board.source)) return <span className={`${BADGE} bg-mw-tint-blue text-mw-record`}>기본 탭</span>;
  if (board.source) return <span className="text-mw-sub">—</span>;
  return <span className="text-mw-body">업무 › {board.nav_section === "before-contract" ? "계약 전" : "계약 후"}</span>;
}

function TabName({ board }: Readonly<{ board: Board }>) {
  return <span className="font-semibold text-mw-fg">{board.icon ? `${board.icon} ` : ""}{board.name}</span>;
}

function PurgeConfirm({ board }: Readonly<{ board: Board }>) {
  return (
    <details className="group">
      <summary className="cursor-pointer select-none list-none rounded-md border border-mw-error/40 px-2.5 py-1 text-xs font-semibold text-mw-error hover:bg-mw-tint-coral [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">지금 완전 삭제</span>
        <span className="hidden group-open:inline">취소</span>
      </summary>
      <form action={purgeBoardAction} className="mt-2 grid max-w-xs gap-2 rounded-md border border-mw-error/40 bg-mw-tint-coral p-2.5 text-left">
        <input type="hidden" name="boardId" value={board.id} />
        <p className="text-xs leading-5 text-mw-fg">
          {quotedObject(board.name)} 완전히 지울까요? 행·메모·파일까지 모두 지워지고 되돌릴 수 없어요.
        </p>
        <button type="submit" className="justify-self-end rounded-md bg-mw-error px-3 py-1.5 text-xs font-semibold text-mw-on-accent hover:opacity-90">
          완전 삭제
        </button>
      </form>
    </details>
  );
}

export function TabTrashSurface({
  activeBoards,
  trashedBoards,
  dismissals,
  defaultTabs,
  params,
  now,
}: Readonly<{
  activeBoards: readonly Board[];
  trashedBoards: readonly Board[];
  dismissals: readonly DefaultTabDismissal[];
  defaultTabs: readonly DefaultTabEntry[];
  params: TabTrashParams;
  now: Date;
}>) {
  const notice = resolveTabTrashNotice(params, { activeBoards, trashedBoards, defaultTabs, now });
  const reinstallable = reinstallableDefaultTabs(dismissals, activeBoards, trashedBoards, defaultTabs);
  const trash = [...trashedBoards].sort((left, right) => (right.deleted_at ?? "").localeCompare(left.deleted_at ?? ""));

  return (
    <section className="flex flex-col gap-4" aria-labelledby="tab-trash-title">
      <header>
        <h2 id="tab-trash-title" className="text-lg font-semibold text-mw-fg">탭 목록·휴지통</h2>
        <p className="mt-1 text-sm text-mw-sub">
          지운 탭은 휴지통에 {BOARD_TRASH_RETENTION_DAYS}일 동안 있어요. 그 안에는 그대로 되살리고, {BOARD_TRASH_RETENTION_DAYS}일이 지나면 완전히 지워져요.
        </p>
      </header>

      {notice ? (
        <p
          role={noticeRole(notice.tone === "success")}
          aria-live={noticeLive(notice.tone === "success")}
          data-testid="tab-trash-notice"
          className={`rounded-md border px-3 py-2 text-sm text-mw-fg ${notice.tone === "error" ? "border-mw-error/40 bg-mw-tint-coral" : "border-mw-success/40 bg-mw-tint-teal"}`}
        >
          {notice.message}
        </p>
      ) : null}

      <section className={CARD} aria-labelledby="tab-list-heading">
        <h3 id="tab-list-heading" className="font-semibold text-mw-fg">탭 목록 <span className="text-sm font-normal text-mw-sub">{activeBoards.length}</span></h3>
        {activeBoards.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-mw-line p-4 text-center text-sm text-mw-sub">아직 탭이 없어요.</p>
        ) : (
          <table className="mt-2 block w-full text-sm sm:table">
            <thead className="hidden sm:table-header-group">
              <tr>
                <th scope="col" className={HEAD_CELL}>탭</th>
                <th scope="col" className={HEAD_CELL}>사이드바 위치</th>
                <th scope="col" className={HEAD_CELL}><span className="sr-only">열기</span></th>
              </tr>
            </thead>
            <tbody className="block sm:table-row-group">
              {activeBoards.map((board) => (
                <tr key={board.id} className={ROW}>
                  <td className={CELL}><TabName board={board} /></td>
                  <td className={`${CELL} text-xs`}>{placeLabel(board)}</td>
                  <td className={`${CELL} sm:text-right`}>
                    <Link href={`/boards/${board.id}`} className="text-xs font-semibold text-mw-record hover:underline">열기</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={CARD} aria-labelledby="tab-trash-heading">
        <h3 id="tab-trash-heading" className="font-semibold text-mw-fg">휴지통 <span className="text-sm font-normal text-mw-sub">{trash.length}</span></h3>
        {trash.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-mw-line p-4 text-center text-sm text-mw-sub">
            휴지통이 비어 있어요. 탭을 지우면 여기에 {BOARD_TRASH_RETENTION_DAYS}일 동안 머물러요.
          </p>
        ) : (
          <table className="mt-2 block w-full text-sm sm:table">
            <thead className="hidden sm:table-header-group">
              <tr>
                <th scope="col" className={HEAD_CELL}>탭</th>
                <th scope="col" className={HEAD_CELL}>지운 날</th>
                <th scope="col" className={HEAD_CELL}>완전 삭제까지</th>
                <th scope="col" className={HEAD_CELL}><span className="sr-only">작업</span></th>
              </tr>
            </thead>
            <tbody className="block sm:table-row-group">
              {trash.map((board) => (
                <tr key={board.id} className={ROW}>
                  <td className={CELL}>
                    <TabName board={board} />
                    {isDefaultTabSource(board.trashed_source) ? <span className={`${BADGE} ml-1.5 bg-mw-tint-blue text-mw-record`}>기본 탭</span> : null}
                  </td>
                  <td className={`${CELL} text-xs text-mw-body`}><span className="text-mw-sub sm:hidden">지운 날 </span>{kstDate(board.deleted_at ?? "")}</td>
                  <td className={`${CELL} text-xs font-medium text-mw-body`}>{trashCountdown(board.deleted_at, now).label}</td>
                  <td className={`${CELL} sm:text-right`}>
                    <div className="flex flex-wrap items-start gap-2 pt-1 sm:justify-end sm:pt-0">
                      <form action={restoreBoardAction}>
                        <input type="hidden" name="boardId" value={board.id} />
                        <button type="submit" className="rounded-md border border-mw-line bg-mw-card px-2.5 py-1 text-xs font-semibold text-mw-fg hover:bg-mw-bg">복구</button>
                      </form>
                      <PurgeConfirm board={board} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {reinstallable.length > 0 ? (
        <section className={CARD} aria-labelledby="dismissed-default-heading">
          <h3 id="dismissed-default-heading" className="font-semibold text-mw-fg">지운 기본 탭</h3>
          <p className="mt-1 text-sm text-mw-sub">지운 기본 탭은 자동으로 다시 만들지 않아요. 필요하면 빈 탭으로 다시 설치하세요.</p>
          <ul className="mt-3 grid gap-2">
            {reinstallable.map((tab) => (
              <li key={tab.source} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-mw-line px-3 py-2">
                <div>
                  <p className="text-sm font-semibold text-mw-fg">{tab.name}</p>
                  <p className="text-xs text-mw-sub">지운 날 {kstDate(tab.dismissedAt)}</p>
                </div>
                <form action={reinstallDefaultTabAction}>
                  <input type="hidden" name="source" value={tab.source} />
                  <button type="submit" className="rounded-md bg-mw-primary px-3 py-1.5 text-xs font-semibold text-mw-on-accent hover:opacity-90">기본 탭 다시 설치</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
