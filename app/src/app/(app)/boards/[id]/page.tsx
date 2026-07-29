import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { applyAs, getSession } from "@/lib/auth/session";
import { CELL_FLASH_COOKIE, decodeCellFlash } from "@/lib/boards/cellFlash";
import { getBoardsService, NotFoundError } from "@/lib/boards";
import { GenericBoardTable } from "@/components/boards/GenericBoardTable";
import { GenericBoardKanban } from "@/components/boards/GenericBoardKanban";
import { ColumnEditor } from "@/components/boards/ColumnEditor";
import { addGroupAction, deleteBoardAction } from "../actions";

/**
 * 범용 보드 화면 (T02b · ADR-0003) — 테이블/칸반 토글.
 * ?view=table|kanban · ?group=<select 컬럼 key>(없으면 board_groups 기준)
 * 시스템 보드(정책자금)는 편집 불가 — 데이터는 001 deals 에 있다.
 */
export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; group?: string; as?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = applyAs(await getSession(), sp.as);
  const svc = getBoardsService();

  let detail;
  try {
    detail = svc.getBoardDetail(ctx, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const { board, columns, groups } = detail;
  const view = sp.view === "kanban" ? "kanban" : "table";
  const selectColumns = columns.filter(
    (c) => c.type === "select" || c.type === "multiselect",
  );
  const groupBy = sp.group && selectColumns.some((c) => c.key === sp.group) ? sp.group : "";
  const items = svc.listItems(ctx, id);
  const lanes = view === "kanban" ? svc.kanban(ctx, id, groupBy || undefined) : [];

  // 직전 셀 편집에서 저장되지 못한 값의 사유(1회성). 없으면 null.
  const cellFlash = decodeCellFlash((await cookies()).get(CELL_FLASH_COOKIE)?.value);

  const qs = (next: Record<string, string>) => {
    const p = new URLSearchParams();
    if (sp.as) p.set("as", sp.as);
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/boards" className="text-xs text-zinc-500 hover:underline">
            ← 보드 목록
          </Link>
          <h1 className="text-xl font-semibold">
            {board.icon} {board.name}
          </h1>
          {board.description && (
            <p className="text-sm text-zinc-500">{board.description}</p>
          )}
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Link
            href={`/boards/${id}${qs({ view: "table", group: groupBy })}`}
            className={`rounded border px-2 py-1 ${view === "table" ? "border-zinc-900 dark:border-zinc-100" : "border-zinc-200 dark:border-zinc-800"}`}
          >
            테이블
          </Link>
          <Link
            href={`/boards/${id}${qs({ view: "kanban", group: groupBy })}`}
            className={`rounded border px-2 py-1 ${view === "kanban" ? "border-zinc-900 dark:border-zinc-100" : "border-zinc-200 dark:border-zinc-800"}`}
          >
            칸반
          </Link>
        </div>
      </div>

      {board.is_system && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          시스템 보드입니다. 정책자금 파이프라인의 딜·정산은 전용 화면에서 관리합니다(구조 편집 불가).
        </p>
      )}

      {view === "kanban" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-500">그룹 기준:</span>
          <Link
            href={`/boards/${id}${qs({ view: "kanban" })}`}
            className={`rounded border px-2 py-0.5 text-xs ${groupBy === "" ? "border-zinc-900 dark:border-zinc-100" : "border-zinc-200 dark:border-zinc-800"}`}
          >
            그룹
          </Link>
          {selectColumns.map((c) => (
            <Link
              key={c.id}
              href={`/boards/${id}${qs({ view: "kanban", group: c.key })}`}
              className={`rounded border px-2 py-0.5 text-xs ${groupBy === c.key ? "border-zinc-900 dark:border-zinc-100" : "border-zinc-200 dark:border-zinc-800"}`}
            >
              {c.label}
            </Link>
          ))}
        </div>
      )}

      {view === "table" ? (
        <GenericBoardTable
          boardId={id}
          columns={columns}
          items={items}
          groups={groups}
          readOnly={board.is_system}
          cellFlash={cellFlash}
        />
      ) : (
        <GenericBoardKanban
          boardId={id}
          lanes={lanes}
          groupBy={groupBy}
          readOnly={board.is_system}
        />
      )}

      {!board.is_system && (
        <div className="flex flex-col gap-3">
          <ColumnEditor boardId={id} columns={columns} />

          <form action={addGroupAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="boardId" value={id} />
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-zinc-500">새 그룹(칸반 레인)</span>
              <input
                name="name"
                required
                placeholder="예: 이번 주"
                className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <button
              type="submit"
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              그룹 추가
            </button>
          </form>

          <form action={deleteBoardAction} className="pt-2">
            <input type="hidden" name="boardId" value={id} />
            <button
              type="submit"
              className="text-xs text-zinc-400 hover:text-red-600"
            >
              이 보드 삭제
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
