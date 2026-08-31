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
  activeFacetCount,
  activeFilterCount,
  EMPTY_FILTERS,
  savedViewFilterPayload,
  type BoardFilterState,
} from "./filters";
import { OtherInfoFacetFilters } from "./OtherInfoFacetFilter";

function toggle(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function OptionPicker({
  label,
  options,
  picked,
  counts,
  onToggle,
}: {
  label: string;
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
      {options.length > 7 ? (
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`${label} 검색`}
          aria-label={`${label} 필터 값 검색`}
          data-filter-autofocus
          className="h-9 rounded-lg border border-mw-line bg-mw-card px-2.5 text-xs outline-none focus:border-mw-record"
        />
      ) : null}
      {options.length === 0 ? (
        <p className="rounded-lg bg-mw-bg px-3 py-4 text-xs leading-5 text-mw-sub">선택할 값이 아직 없습니다. 행에 값이 생기면 여기에 표시됩니다.</p>
      ) : visible.length === 0 ? (
        <p className="rounded-lg bg-mw-bg px-3 py-4 text-xs text-mw-sub">검색과 일치하는 값이 없습니다.</p>
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
  legacyFacetLabels = {},
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
  /** presentation에서 숨긴 physical facet이 이미 활성일 때만 보여 주는 clear-only 라벨. */
  legacyFacetLabels?: Readonly<Record<string, string>>;
}) {
  // `status` 도 선택지 컬럼이다(BBE-145). BBE-123 이 타입 15종을 넣으면서 select 에서
  // «상태»(버튼으로 바꾸는 단계값)를 분리했는데 이 필터 목록은 그때 같이 안 늘었다.
  // 그래서 신규리드의 핵심 필터인 「상담 상황」·「컨택 이동」·「피드백 상황」이 전부
  // 칩으로 뜨지 않았다 — 표에서는 StatusCell 로 잘 그리면서 필터에서만 빠져 있었다.
  const optionColumns = useMemo(
    () => columns.filter(
      (c) =>
        (c.type === "select" || c.type === "multiselect" || c.type === "status") &&
        c.options_jsonb?.options?.length,
    ),
    [columns],
  );
  const otherInfoColumns = columns.filter((column) => column.type === "other_info");
  const active = activeFilterCount(filters);
  const activeSorts = filters.sorts?.length
    ? filters.sorts
    : filters.sortKey
      ? [{ columnKey: filters.sortKey, direction: filters.sortDir }]
      : [];
  const optionColumnKeys = new Set(optionColumns.map((column) => column.key));
  const clearableLegacyFacetLabels = {
    closed_business: "기존 폐업여부",
    export_status: "기존 수출여부",
    ...legacyFacetLabels,
  };
  const activeLegacyFacets = Object.entries(clearableLegacyFacetLabels).flatMap(([key, label]) => {
    const picked = filters.byColumn[key] ?? [];
    return picked.length > 0 && !optionColumnKeys.has(key) ? [{ key, label, picked }] : [];
  });
  const sortSummary = activeSorts.map((sort) => {
    const column = columns.find((candidate) => candidate.key === sort.columnKey);
    return `${column?.label ?? sort.columnKey} ${sort.direction === "asc" ? "↑" : "↓"}`;
  }).join(" · ");

  const patch = (p: Partial<BoardFilterState>) => onChange({ ...filters, ...p });
  const visibleColumnKeys = filters.visibleColumnKeys ?? null;
  const selectedColumnKeys = visibleColumnKeys === null
    ? columns.map((column) => column.key)
    : visibleColumnKeys;
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

  /** 접힌 패널 «안에» 걸린 수만 센다 — 검색·정렬·표시 컬럼은 패널 밖이라 빼야 배지가 정직하다. */
  const facetCount = activeFacetCount(filters);
  /*
   * ★ 걸린 필터가 있으면 «기본으로 열려» 있다 (#602).
   *
   *   #602 가 세운 계약은 「저장된 뷰에서 되살아난 필터는 «보여야» 한다」다.
   *   보이지 않으면 사용자는 «왜 행이 줄었는지» 를 알 방법이 없다 — 조용한 누락이 된다.
   *   그래서 접는 것은 «아무것도 안 걸린» 상태뿐이다. 총괄이 막막하다고 한 것도 그 상태다.
   *
   *   사용자가 직접 접거나 편 뒤에는 그 선택이 이긴다(override). null 인 동안만 데이터를 따른다 —
   *   useState 초기값으로만 두면 나중에 저장뷰를 불러와 필터가 걸려도 안 열린다.
   */
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const filtersOpen = openOverride ?? facetCount > 0;
  const setFiltersOpen = (next: boolean) => setOpenOverride(next);
  /**
   * 필터가 하나도 만들어질 수 없는 보드에서는 「필터」 버튼을 아예 안 그린다.
   * 열어도 빈 패널이면 «있는데 비었다» 와 «애초에 없다» 를 구분 못 한다.
   */
  const hasFacets =
    people.length > 0 ||
    otherInfoColumns.length > 0 ||
    optionColumns.length > 0 ||
    activeLegacyFacets.length > 0;

  /*
   * #655 — 도구줄을 «찾기 · 보기 · 저장» 세 묶음으로 나누고 필터는 접는다.
   *
   * 전에는 성격이 다른 컨트롤 13개가 같은 모양·같은 크기로 한 줄에 있었다. 구분선도
   * 묶음 이름도 없어서 「무엇을 바꾸면 무엇이 달라지는지」를 눈으로 읽을 수 없었다.
   * 총괄의 말: 「너무 복잡하고 내용구분이 안되어있으니 … 의사결정이 힘들다」.
   *
   * ★ 없애는 기능은 하나도 없다. 접는 것과 지우는 것은 다르다(D71~D75).
   *   필터 칩은 전부 그대로 살아서 패널 안으로 들어간다.
   *
   * ★ 필터 9개 중 대부분은 select 컬럼에서 «자동으로» 만들어진다. 그래서 접지 않으면
   *   컬럼을 만들 때마다 줄이 길어지고 상한이 없다. 접으면 바깥 줄은 컬럼 수와 무관해진다.
   *
   * ★ 패널은 팝오버가 아니라 «줄 아래로 펼쳐지는 영역» 이다.
   *   FilterChip 은 포털 팝오버이고 열릴 때 moawork:popover-open 으로 서로를 닫는다.
   *   패널까지 팝오버로 만들면 안쪽 칩을 여는 순간 패널이 닫힌다.
   */
  const facetChips = (
    <>
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
            label="담당자"
            options={people.map((person) => ({ id: person.value, label: person.label }))}
            picked={filters.assignees}
            counts={peopleCounts}
            onToggle={(id) => patch({ assignees: toggle(filters.assignees, id) })}
          />
        </FilterChip>
      )}

      {otherInfoColumns.map((column) => (
        <OtherInfoFacetFilters
          key={column.id}
          rows={rows}
          columnKey={column.key}
          columnLabel={column.label}
          qualifyLabel={otherInfoColumns.length > 1}
          filters={filters}
          onChange={onChange}
        />
      ))}

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
              label={col.label}
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

      {activeLegacyFacets.map(({ key, label, picked }) => (
        <FilterChip
          key={key}
          label={label}
          summary={picked.length === 1 ? picked[0] : `${picked.length}개`}
          active
          onClear={() => patch({ byColumn: { ...filters.byColumn, [key]: [] } })}
        >
          <p className="rounded-lg bg-mw-bg px-3 py-3 text-xs leading-5 text-mw-sub">
            저장된 뷰의 기존 필터입니다. 값을 유지하거나 선택 해제로 지울 수 있어요.
          </p>
        </FilterChip>
      ))}
    </>
  );

  const viewChips = (
    <>
      <FilterChip
        label="정렬"
        summary={sortSummary || undefined}
        active={activeSorts.length > 0}
        onClear={() => patch({ sortKey: "", sortDir: "asc", sorts: [] })}
      >
        <RadioOption
          label="기본 순서(직접 배치)"
          checked={activeSorts.length === 0}
          onPick={() => patch({ sortKey: "", sortDir: "asc", sorts: [] })}
        />
        {columns.map((column) => {
          const index = activeSorts.findIndex((sort) => sort.columnKey === column.key);
          const selected = index >= 0;
          const direction = selected ? activeSorts[index].direction : "asc";
          return (
            <div key={column.id} className="flex items-center gap-1">
              <RadioOption
                label={`${selected ? `${index + 1}. ` : ""}${column.label}`}
                checked={selected}
                onPick={() => patch({
                  sortKey: "",
                  sortDir: "asc",
                  sorts: selected
                    ? activeSorts.filter((sort) => sort.columnKey !== column.key)
                    : [...activeSorts, { columnKey: column.key, direction: "asc" }],
                })}
              />
              {selected ? (
                <button
                  type="button"
                  className="rounded px-1 text-xs text-mw-sub hover:bg-mw-hover"
                  aria-label={`${column.label} 정렬 방향`}
                  onClick={() => patch({ sorts: activeSorts.map((sort) => sort.columnKey === column.key ? { ...sort, direction: direction === "asc" ? "desc" : "asc" } : sort) })}
                >
                  {direction === "asc" ? "↑" : "↓"}
                </button>
              ) : null}
            </div>
          );
        })}
      </FilterChip>

      <FilterChip
        label="표시 컬럼"
        summary={`${selectedColumnKeys.length}/${columns.length}`}
        active={visibleColumnKeys !== null}
        onClear={() => patch({ columnLimit: 0, visibleColumnKeys: null })}
      >
        <RadioOption
          label={`전체 보기 (${columns.length})`}
          checked={visibleColumnKeys === null}
          onPick={() => patch({ columnLimit: 0, visibleColumnKeys: null })}
        />
        <div className="my-1 border-t border-mw-line" />
        {columns.map((column) => (
          <CheckOption
            key={column.id}
            label={column.label}
            checked={selectedColumnKeys.includes(column.key)}
            onToggle={() => {
              const next = toggle(selectedColumnKeys, column.key);
              patch({
                columnLimit: 0,
                visibleColumnKeys: next.length === columns.length ? null : next,
              });
            }}
          />
        ))}
        <p className="mt-2 border-t border-mw-line pt-2 text-[11px] leading-4 text-mw-sub">
          이 선택은 현재 주소에 남습니다. «뷰로 저장»하면 해당 뷰에만 포함되고 다른 사람의 기본 화면은 바뀌지 않습니다.
        </p>
      </FilterChip>
    </>
  );

  return (
    <div className="flex flex-col gap-1.5">
      {/*
        도구줄은 여전히 «1줄» 이다(ui-guidelines 원칙 4·9). 넘치면 꺾이지 않고 가로로 흐른다.
        달라진 것은 «몇 개가 서 있는가» 다 — 필터가 접히면서 컬럼 수와 무관해졌다.
      */}
      <div
        data-board-toolbar
        className="mw-board-inline-scroll flex flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden pb-1"
      >
        <span className="shrink-0 select-none pr-0.5 text-[10px] tracking-wide text-mw-sub">찾기</span>

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

        {hasFacets && (
          <button
            type="button"
            data-board-filter-toggle
            aria-expanded={filtersOpen}
            aria-controls="board-filter-panel"
            onClick={() => setFiltersOpen(!filtersOpen)}
            className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors ${
              facetCount > 0
                ? "border-mw-record bg-mw-tint-blue text-mw-record"
                : "border-mw-line bg-mw-card text-mw-body hover:border-mw-sub"
            }`}
          >
            필터
            {/*
              ★ 걸린 개수를 «버튼 위에» 적는다. 접었는데 몇 개가 걸렸는지 모르면
                접은 것이 아니라 숨긴 것이 된다.
            */}
            {facetCount > 0 ? (
              <span className="rounded-full bg-mw-record px-1.5 text-[10px] font-semibold leading-4 text-mw-on-accent tabular-nums">
                {facetCount}
              </span>
            ) : null}
            <span aria-hidden="true" className="text-[8px] text-mw-sub">{filtersOpen ? "▴" : "▾"}</span>
          </button>
        )}

        <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-mw-line" />
        <span className="shrink-0 select-none pr-0.5 text-[10px] tracking-wide text-mw-sub">보기</span>
        {viewChips}

        <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-mw-line" />
        <span className="shrink-0 select-none pr-0.5 text-[10px] tracking-wide text-mw-sub">저장</span>
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

      {hasFacets && filtersOpen ? (
        <div
          id="board-filter-panel"
          data-board-filter-panel
          className="flex flex-col gap-2 rounded-xl border border-mw-line bg-mw-card p-3"
        >
          <div className="flex flex-wrap items-center gap-2">{facetChips}</div>
          <div className="flex items-center justify-between gap-2 border-t border-mw-line pt-2">
            <span className="text-[11px] text-mw-sub">
              {facetCount > 0 ? `${facetCount}개가 걸려 있어요` : "아직 걸린 필터가 없어요"}
            </span>
            <div className="flex items-center gap-2">
              {facetCount > 0 && (
                <button
                  type="button"
                  onClick={() => patch({ assignees: [], byColumn: {} })}
                  className="rounded-full px-2 text-[11px] text-mw-sub underline-offset-2 hover:text-mw-fg hover:underline"
                >
                  필터만 지우기
                </button>
              )}
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="h-7 rounded-full border border-mw-line bg-mw-bg px-3 text-xs text-mw-body hover:border-mw-sub"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
