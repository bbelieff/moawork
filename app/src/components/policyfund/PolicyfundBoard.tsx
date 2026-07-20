"use client";

// T09 · 정책자금 보드 화면 — 먼데이 "업무관리" 31컬럼 재현(테이블).
// 파이프라인 단계 필터·정렬 포함. 데이터(컬럼·아이템)는 props(소스 무관).

import { useMemo, useState } from "react";
import type { BoardColumn, BoardItem } from "@/lib/policyfund";
import { filterByStage, sortByStage, countByStage } from "@/lib/policyfund";

export interface PolicyfundBoardProps {
  columns: BoardColumn[];
  items?: BoardItem[];
  /** 단계 필터/정렬에 쓰는 컬럼 라벨(예: "진행상항"). */
  stageColumn?: string;
  /** 단계 순서(시드 옵션 순서). 정렬·필터 옵션에 사용. */
  stageOrder?: string[];
}

const TYPE_BADGE: Record<string, string> = {
  formula: "∑",
  select: "▾",
  date: "📅",
  number: "#",
  file: "📎",
  person: "👤",
};

/** 업무관리 보드 테이블 + 단계 필터/정렬 컨트롤. */
export function PolicyfundBoard({
  columns,
  items = [],
  stageColumn,
  stageOrder = [],
}: PolicyfundBoardProps) {
  const [stage, setStage] = useState<string>("");
  const [sorted, setSorted] = useState(false);

  const rows = useMemo(() => {
    if (!stageColumn) return items;
    let out = stage ? filterByStage(items, stageColumn, stage) : items;
    if (sorted && stageOrder.length) {
      out = sortByStage(out, stageColumn, stageOrder);
    }
    return out;
  }, [items, stageColumn, stage, sorted, stageOrder]);

  const counts = useMemo(
    () => (stageColumn ? countByStage(items, stageColumn) : {}),
    [items, stageColumn],
  );

  return (
    <div className="flex flex-col gap-3">
      {stageColumn ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="font-medium">단계</span>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              className="h-8 rounded-md border border-black/15 bg-transparent px-2 dark:border-white/20"
            >
              <option value="">전체</option>
              {stageOrder.map((s) => (
                <option key={s} value={s}>
                  {s}
                  {counts[s] ? ` (${counts[s]})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={sorted}
              onChange={(e) => setSorted(e.target.checked)}
            />
            <span>단계순 정렬</span>
          </label>
          <span className="text-zinc-500">{rows.length}건</span>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
        <table className="w-max min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-black/10 bg-black/[.03] dark:border-white/10 dark:bg-white/[.04]">
              {columns.map((col) => (
                <th
                  key={col.index}
                  scope="col"
                  className="whitespace-nowrap px-3 py-2 text-left font-medium"
                  title={col.formula ?? col.optionRef ?? col.type}
                >
                  <span className="flex items-center gap-1">
                    {col.label}
                    <span className="text-xs text-zinc-400">
                      {TYPE_BADGE[col.type] ?? ""}
                    </span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length || 1}
                  className="px-3 py-8 text-center text-zinc-500"
                >
                  아이템이 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-black/5 last:border-0 dark:border-white/5"
                >
                  {columns.map((col) => (
                    <td
                      key={col.index}
                      className="whitespace-nowrap px-3 py-2 text-zinc-700 dark:text-zinc-300"
                    >
                      {formatCell(item.cells[col.label])}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatCell(v: BoardItem["cells"][string] | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return v.toLocaleString("ko-KR");
  if (typeof v === "boolean") return v ? "✓" : "—";
  return v;
}
