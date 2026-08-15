"use client";

/**
 * 도구줄 — **1줄 고정** (ui-guidelines 원칙 4·9).
 *
 * 줄바꿈 금지가 핵심 제약이다. `flex-nowrap` + `overflow-x-auto` 로 넘치면 2줄로 꺾이지 않고
 * 가로로 흐르게 한다(원칙 9 가 명시한 두 허용 처리 중 하나).
 *
 * 칩 구성은 하드코딩하지 않고 **보드 스키마에서 유도**한다 — 선택지(select/multiselect)
 * 컬럼마다 칩이 하나씩 생긴다. 신규업체 보드에서는 그게 곧 "상담상황·사업자유형…" 이 되고,
 * 다른 보드에서도 같은 도구줄이 그 보드의 어휘로 나온다.
 */

import { useMemo, useState } from "react";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import { CheckOption, FilterChip, RadioOption } from "./FilterChip";
import {
  activeFilterCount,
  EMPTY_FILTERS,
  savedViewFilterPayload,
  type BoardFilterState,
} from "./filters";

/** 컬럼수 칩의 선택지 — 0 = 전부. */
const COLUMN_LIMITS = [0, 8, 12, 16] as const;

function toggle(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function OptionPicker({
  options,
  picked,
  counts,
  onToggle,
}: {
  options: { id: string; label: string }[];
  picked: readonly string[];
  counts: Readonly<Record<string, number>>;
  onToggle: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const visible = options.filter((option) =>
    option.label.toLocaleLowerCase("ko").includes(query.trim().toLocaleLowerCase("ko")),
  );
  return (
    <div className="flex flex-col gap-1">
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="값 검색"
        aria-label="필터 값 검색"
        className="h-8 rounded-lg border border-mw-line bg-mw-card px-2 text-xs outline-none focus:border-mw-record"
      />
      {visible.length === 0 ? (
        <p className="px-2 py-3 text-xs text-mw-sub">일치하는 값이 없습니다.</p>
      ) : (
        visible.map((option) => (
          <CheckOption
            key={option.id}
            label={`${option.label} (${counts[option.id] ?? 0})`}
            checked={picked.includes(option.id)}
            onToggle={() => onToggle(option.id)}
          />
        ))
      )}
    </div>
  );
}

export function BoardToolbar({
  columns,
  rows = [],
  filters,
  onChange,
  matched,
  total,
  people,
}: {
  /** 보드 전체 컬럼(그룹 오버라이드 적용 전) — 필터·정렬 대상은 보드 전역이다. */
  columns: readonly BoardColumn[];
  rows?: readonly ItemWithValues[];
  filters: BoardFilterState;
  onChange: (next: BoardFilterState) => void;
  matched: number;
  total: number;
  /** 담당자 선택지 — 헤더 탭과 같은 목록을 그대로 받는다(둘이 어긋나지 않게). */
  people: { value: string; label: string }[];
}) {
  // `status` 도 선택지 컬럼이다(BBE-145). BBE-123 이 타입 15종을 넣으면서 select 에서
  // «상태»(버튼으로 바꾸는 단계값)를 분리했는데 이 필터 목록은 그때 같이 안 늘었다.
  // 그래서 신규리드의 핵심 필터인 「상담 상황」·「컨택 이동」·「피드백 상황」이 전부
  // 칩으로 뜨지 않았다 — 표에서는 StatusCell 로 잘 그리면서 필터에서만 빠져 있었다.
  const optionColumns = columns.filter(
    (c) =>
      (c.type === "select" || c.type === "multiselect" || c.type === "status") &&
      c.options_jsonb?.options?.length,
  );
  const active = activeFilterCount(filters);
  const sortColumn = columns.find((c) => c.key === filters.sortKey);

  const patch = (p: Partial<BoardFilterState>) => onChange({ ...filters, ...p });
  const optionCounts = useMemo(() => {
    const counts: Record<string, Record<string, number>> = {};
    for (const column of optionColumns) {
      const perValue: Record<string, number> = {};
      for (const row of rows) {
        const raw = row.values[column.key];
        const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
        for (const value of new Set(values.map(String))) {
          perValue[value] = (perValue[value] ?? 0) + 1;
        }
      }
      counts[column.key] = perValue;
    }
    return counts;
  }, [optionColumns, rows]);
  const peopleCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of rows) {
      const value = row.assigned_to ?? "__unassigned__";
      counts[value] = (counts[value] ?? 0) + 1;
    }
    return counts;
  }, [rows]);

  const requestSaveView = () => {
    window.dispatchEvent(
      new CustomEvent("moawork:save-board-view", {
        detail: savedViewFilterPayload(filters),
      }),
    );
  };

  return (
    <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-1">
      {/* 검색 — 칩이 아니라 입력 자체를 노출한다(가장 자주 쓰는 컨트롤). */}
      <div className="relative shrink-0">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-mw-sub"
        >
          ⌕
        </span>
        <input
          type="search"
          value={filters.q}
          onChange={(e) => patch({ q: e.target.value })}
          placeholder="검색"
          aria-label="보드 검색"
          className="h-7 w-52 rounded-full border border-mw-line bg-mw-card pl-7 pr-3 text-xs text-mw-fg outline-none placeholder:text-mw-sub focus:border-mw-record"
        />
      </div>

      {people.length > 0 && (
        <FilterChip
          label="담당자"
          summary={
            filters.assignees.length === 1
              ? people.find((person) => person.value === filters.assignees[0])?.label
              : filters.assignees.length > 1
                ? `${filters.assignees.length}개`
                : undefined
          }
          active={filters.assignees.length > 0}
          onClear={() => patch({ assignees: [] })}
        >
          <OptionPicker
            options={people.map((person) => ({ id: person.value, label: person.label }))}
            picked={filters.assignees}
            counts={peopleCounts}
            onToggle={(id) => patch({ assignees: toggle(filters.assignees, id) })}
          />
        </FilterChip>
      )}

      {optionColumns.map((col) => {
        const picked = filters.byColumn[col.key] ?? [];
        return (
          <FilterChip
            key={col.id}
            label={col.label}
            summary={
              picked.length === 1
                ? col.options_jsonb?.options?.find((option) => option.id === picked[0])?.label
                : picked.length > 1
                  ? `${picked.length}개`
                  : undefined
            }
            active={picked.length > 0}
            onClear={() => patch({ byColumn: { ...filters.byColumn, [col.key]: [] } })}
          >
            <OptionPicker
              options={col.options_jsonb?.options ?? []}
              picked={picked}
              counts={optionCounts[col.key] ?? {}}
              onToggle={(id) =>
                patch({ byColumn: { ...filters.byColumn, [col.key]: toggle(picked, id) } })
              }
            />
          </FilterChip>
        );
      })}

      <FilterChip
        label="정렬"
        summary={
          sortColumn ? `${sortColumn.label} ${filters.sortDir === "asc" ? "↑" : "↓"}` : undefined
        }
        active={filters.sortKey !== ""}
        onClear={() => patch({ sortKey: "", sortDir: "asc" })}
      >
        <RadioOption
          label="기본 순서(직접 배치)"
          checked={filters.sortKey === ""}
          onPick={() => patch({ sortKey: "" })}
        />
        {columns.map((c) => (
          <RadioOption
            key={c.id}
            label={c.label}
            checked={filters.sortKey === c.key}
            onPick={() => patch({ sortKey: c.key })}
          />
        ))}
        {filters.sortKey !== "" && (
          <div className="mt-1 flex gap-1 border-t border-mw-line pt-1">
            <RadioOption
              label="오름차순 ↑"
              checked={filters.sortDir === "asc"}
              onPick={() => patch({ sortDir: "asc" })}
            />
            <RadioOption
              label="내림차순 ↓"
              checked={filters.sortDir === "desc"}
              onPick={() => patch({ sortDir: "desc" })}
            />
          </div>
        )}
      </FilterChip>

      {/*
        컬럼수 칩 — 요약은 v5 2-3 형식대로 "표시 중/전체"(예: 21/26)를 항상 보여준다.
        active(틴트)는 전체보다 적게 골랐을 때만 — 기본값(전부 보임)은 강조하지 않는다.
      */}
      <FilterChip
        label="컬럼"
        summary={`${
          filters.columnLimit > 0 ? Math.min(filters.columnLimit, columns.length) : columns.length
        }/${columns.length}`}
        active={filters.columnLimit > 0 && filters.columnLimit < columns.length}
        onClear={() => patch({ columnLimit: 0 })}
      >
        {COLUMN_LIMITS.map((n) => (
          <RadioOption
            key={n}
            label={n === 0 ? `전부 (${columns.length})` : `${n}개`}
            checked={filters.columnLimit === n}
            onPick={() => patch({ columnLimit: n })}
          />
        ))}
      </FilterChip>

      {active > 0 && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="h-7 shrink-0 rounded-full px-3 text-xs text-mw-sub underline-offset-2 hover:text-mw-fg hover:underline"
        >
          초기화
        </button>
      )}

      <button
        type="button"
        onClick={requestSaveView}
        className="h-7 shrink-0 rounded-full border border-mw-line bg-mw-card px-3 text-xs text-mw-body hover:border-mw-record hover:text-mw-record"
      >
        뷰로 저장
      </button>

      {/* 필터가 걸린 동안에는 "몇 건이 숨겨졌는지"가 보여야 한다 — 조용한 누락 방지. */}
      <span className="ml-auto shrink-0 pl-2 text-xs text-mw-sub">
        {matched === total ? `${total}건` : `${matched} / ${total}건`}
      </span>
    </div>
  );
}
