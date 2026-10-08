"use client";

/**
 * 「보기 조건」 칸 — #845 6단계(2026-10-08 대표 결정).
 *
 * 보기 줄의 칩을 누르면 줄 «아래로 펼쳐지는» 칸이다(팝오버가 아니다 — 안쪽 골라 보기 칩이 팝오버라
 * 팝오버 안에 팝오버가 생기지 않게). 왼쪽 탭: 골라 보기 · 담당 · 줄 세우기 · 나눠 보기 · 보이는 칸.
 * 고르는 화면은 예전 도구줄의 것을 그대로 옮겼다(필터 칩·담당자·정렬·표시 컬럼).
 *
 * 메뉴·칸은 짧게(대표: "설명이 너무 많아 메뉴는 간결하게") — 항목은 한 줄, 풀이 문단이 없다.
 * 휴대폰(바닥 시트)에서는 골라 보기도 팝오버 대신 그 자리에서 펼친다.
 */

import { useMemo, useState, type ReactNode } from "react";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import {
  OTHER_INFO_KEYS,
  OTHER_INFO_LABELS,
  otherInfoFacetFilterKey,
  otherInfoFacetState,
  otherInfoLegacyFromValues,
  type OtherInfoFacetState,
} from "@/lib/boards/structured-field";
import { CheckOption, FilterChip, RadioOption } from "./FilterChip";
import { columnSortOptions } from "./column-menu-model";
import { UNASSIGNED, type BoardFilterState } from "./filters";
import { OtherInfoFacetFilters } from "./OtherInfoFacetFilter";

/**
 * 골라 보기에 칩이 생기는 칸인가 — 선택지가 있는 목록·상태 칸과 기타정보 칸.
 * 칸 메뉴의 「골라 보기…」 도 이 칸들에서만 보인다.
 */
export function hasToolbarFacet(column: Pick<BoardColumn, "type" | "options_jsonb">): boolean {
  if (column.type === "other_info") return true;
  return (column.type === "select" || column.type === "multiselect" || column.type === "status")
    && Boolean(column.options_jsonb?.options?.length);
}

/** 칸 메뉴가 「골라 보기…」 로 이 칸의 골라 보기를 열어 달라는 요청. seq 가 바뀔 때마다 한 번 연다. */
export type ToolbarFilterFocus = Readonly<{ columnKey: string; seq: number }>;

export type ConditionTab = "filter" | "assignee" | "sort" | "group" | "columns";

export const CONDITION_TABS: readonly { id: ConditionTab; label: string }[] = [
  { id: "filter", label: "골라 보기" },
  { id: "assignee", label: "담당" },
  { id: "sort", label: "줄 세우기" },
  { id: "group", label: "나눠 보기" },
  { id: "columns", label: "보이는 칸" },
];

const OTHER_INFO_STATES: readonly { id: OtherInfoFacetState; label: string }[] = [
  { id: "missing", label: "값 없음" },
  { id: "false", label: "미체크" },
  { id: "true", label: "체크" },
];

function toggle(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function OptionPicker({
  label,
  options,
  picked,
  counts,
  onToggle,
}: {
  label: string;
  options: readonly { id: string; label: string }[];
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
          placeholder={`${label} 찾기`}
          aria-label={`${label} 값 찾기`}
          data-filter-autofocus
          className="h-9 rounded-lg border border-mw-line bg-mw-card px-2.5 text-xs outline-none focus:border-mw-record"
        />
      ) : null}
      {options.length === 0 ? (
        <p className="px-2 py-3 text-xs text-mw-sub">고를 값이 없어요</p>
      ) : visible.length === 0 ? (
        <p className="px-2 py-3 text-xs text-mw-sub">맞는 값이 없어요</p>
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

/** 휴대폰 시트의 골라 보기 한 칸 — 팝오버 대신 그 자리에서 펼친다. */
function InlineFacet({ label, summary, children }: { label: string; summary?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-mw-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`flex min-h-11 w-full items-center gap-2 px-3 text-left text-[length:var(--fs-13)] ${summary ? "font-semibold text-mw-record" : "text-mw-body"}`}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {summary ? <span className="shrink-0 text-xs">{summary}</span> : null}
        <span aria-hidden="true" className="text-[0.6rem] text-mw-sub">{open ? "▲" : "▼"}</span>
      </button>
      {open ? <div className="border-t border-mw-line p-1.5">{children}</div> : null}
    </div>
  );
}

export function ViewConditionsPanel({
  variant = "panel",
  tab,
  onTab,
  columns,
  rows,
  filters,
  onChange,
  people,
  currentUserId,
  legacyFacetLabels = {},
  focusFilter = null,
  groupBy,
  groupByOptions = [],
  onGroupBy,
  onClose,
  footer,
}: {
  /** panel = 보기 줄 아래로 펼침(넓은 화면) · sheet = 휴대폰 바닥 시트 */
  variant?: "panel" | "sheet";
  tab: ConditionTab;
  onTab: (tab: ConditionTab) => void;
  /** 화면 칸(신규리드는 합성 칸 key) — 골라 보기·줄 세우기·보이는 칸의 대상. */
  columns: readonly BoardColumn[];
  rows: readonly ItemWithValues[];
  filters: BoardFilterState;
  onChange: (next: BoardFilterState) => void;
  people: readonly { value: string; label: string }[];
  currentUserId?: string;
  /** 화면에서 감춘 예전 칸이 아직 걸려 있을 때 지울 수 있게 보이는 이름. */
  legacyFacetLabels?: Readonly<Record<string, string>>;
  /** 칸 메뉴 「골라 보기…」 — 그 칸의 칩을 연다. */
  focusFilter?: ToolbarFilterFocus | null;
  groupBy: string;
  /** 나눠 보기에 고를 수 있는 칸(보드별 말고). 없으면 「보드별」 하나다. */
  groupByOptions?: readonly { key: string; label: string }[];
  onGroupBy?: (key: string) => void;
  onClose?: () => void;
  /** 시트 아래쪽(되돌리기·저장). */
  footer?: ReactNode;
}) {
  const patch = (p: Partial<BoardFilterState>) => onChange({ ...filters, ...p });
  const optionColumns = useMemo(
    () => columns.filter((c) => c.type !== "other_info" && hasToolbarFacet(c)),
    [columns],
  );
  const otherInfoColumns = columns.filter((column) => column.type === "other_info");
  const optionColumnKeys = new Set(optionColumns.map((column) => column.key));
  const clearableLegacyFacetLabels: Record<string, string> = {
    closed_business: "기존 폐업여부",
    export_status: "기존 수출여부",
    ...legacyFacetLabels,
  };
  const activeLegacyFacets = Object.entries(clearableLegacyFacetLabels).flatMap(([key, label]) => {
    const picked = filters.byColumn[key] ?? [];
    return picked.length > 0 && !optionColumnKeys.has(key) ? [{ key, label, picked }] : [];
  });
  const optionCounts = useMemo(() => {
    const counts: Record<string, Record<string, number>> = {};
    for (const column of optionColumns) {
      const perValue: Record<string, number> = {};
      for (const row of rows) {
        const raw = row.values[column.key];
        const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
        for (const value of new Set(values.map(String))) perValue[value] = (perValue[value] ?? 0) + 1;
      }
      counts[column.key] = perValue;
    }
    return counts;
  }, [optionColumns, rows]);
  const peopleCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of rows) {
      const value = row.assigned_to ?? UNASSIGNED;
      counts[value] = (counts[value] ?? 0) + 1;
    }
    return counts;
  }, [rows]);
  const sheet = variant === "sheet";
  const pickedFilters = Object.values(filters.byColumn).filter((picked) => picked.length > 0).length;

  const summaryOf = (picked: readonly string[], options: readonly { id: string; label: string }[]) =>
    picked.length === 1 ? options.find((option) => option.id === picked[0])?.label ?? picked[0] : picked.length > 1 ? `${picked.length}개` : undefined;

  /* ── 골라 보기 ── */
  const filterContent = (
    <div className="flex flex-col gap-2">
      <div className={sheet ? "flex flex-col gap-1.5" : "flex flex-wrap items-center gap-2"}>
        {optionColumns.map((col) => {
          const picked = filters.byColumn[col.key] ?? [];
          const options = col.options_jsonb?.options ?? [];
          const picker = (
            <OptionPicker
              label={col.label}
              options={options}
              picked={picked}
              counts={optionCounts[col.key] ?? {}}
              onToggle={(id) => patch({ byColumn: { ...filters.byColumn, [col.key]: toggle(picked, id) } })}
            />
          );
          return sheet ? (
            <InlineFacet key={col.id} label={col.label} summary={summaryOf(picked, options)}>{picker}</InlineFacet>
          ) : (
            <FilterChip
              key={col.id}
              label={col.label}
              summary={summaryOf(picked, options)}
              active={picked.length > 0}
              onClear={() => patch({ byColumn: { ...filters.byColumn, [col.key]: [] } })}
              openSignal={focusFilter?.columnKey === col.key ? focusFilter.seq : undefined}
            >
              {picker}
            </FilterChip>
          );
        })}

        {otherInfoColumns.map((column) => sheet ? (
          OTHER_INFO_KEYS.map((key) => {
            const filterKey = otherInfoFacetFilterKey(column.key, key);
            const picked = filters.byColumn[filterKey] ?? [];
            const counts: Record<string, number> = { missing: 0, false: 0, true: 0 };
            for (const row of rows) {
              counts[otherInfoFacetState(
                row.values[column.key] ?? null,
                key,
                column.key === "other_info" ? otherInfoLegacyFromValues(row.values) : undefined,
              )] += 1;
            }
            const label = otherInfoColumns.length > 1 ? `${column.label} · ${OTHER_INFO_LABELS[key]}` : OTHER_INFO_LABELS[key];
            return (
              <InlineFacet key={`${column.id}:${key}`} label={label} summary={summaryOf(picked, OTHER_INFO_STATES)}>
                {OTHER_INFO_STATES.map((state) => (
                  <CheckOption
                    key={state.id}
                    label={`${state.label} (${counts[state.id]})`}
                    checked={picked.includes(state.id)}
                    onToggle={() => patch({ byColumn: { ...filters.byColumn, [filterKey]: toggle(picked, state.id) } })}
                  />
                ))}
              </InlineFacet>
            );
          })
        ) : (
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

        {activeLegacyFacets.map(({ key, label, picked }) => sheet ? (
          <InlineFacet key={key} label={label} summary={picked.length === 1 ? picked[0] : `${picked.length}개`}>
            {picked.map((value) => (
              <CheckOption
                key={value}
                label={value}
                checked
                onToggle={() => patch({ byColumn: { ...filters.byColumn, [key]: picked.filter((entry) => entry !== value) } })}
              />
            ))}
          </InlineFacet>
        ) : (
          <FilterChip
            key={key}
            label={label}
            summary={picked.length === 1 ? picked[0] : `${picked.length}개`}
            active
            onClear={() => patch({ byColumn: { ...filters.byColumn, [key]: [] } })}
          >
            {picked.map((value) => (
              <CheckOption
                key={value}
                label={value}
                checked
                onToggle={() => patch({ byColumn: { ...filters.byColumn, [key]: picked.filter((entry) => entry !== value) } })}
              />
            ))}
          </FilterChip>
        ))}
      </div>
      {optionColumns.length === 0 && otherInfoColumns.length === 0 && activeLegacyFacets.length === 0 ? (
        <p className="text-xs text-mw-sub">고를 칸이 없어요</p>
      ) : null}
      {pickedFilters > 0 ? (
        <button
          type="button"
          onClick={() => patch({ byColumn: {} })}
          className="self-start rounded-full px-2 text-xs text-mw-sub underline-offset-2 hover:text-mw-fg hover:underline"
        >
          모두 지우기
        </button>
      ) : null}
    </div>
  );

  /* ── 담당 ── */
  const assigneeContent = (
    <div className="flex max-w-sm flex-col gap-0.5">
      <RadioOption label="전체" checked={filters.assignees.length === 0} onPick={() => patch({ assignees: [] })} />
      {currentUserId ? (
        <RadioOption
          label="나"
          checked={filters.assignees.length === 1 && filters.assignees[0] === currentUserId}
          onPick={() => patch({ assignees: [currentUserId] })}
        />
      ) : null}
      {people.length > 0 ? <div role="separator" className="my-1 border-t border-mw-line" /> : null}
      {people.map((person) => (
        <CheckOption
          key={person.value}
          label={`${person.label} (${peopleCounts[person.value] ?? 0})`}
          checked={filters.assignees.includes(person.value)}
          onToggle={() => patch({ assignees: toggle(filters.assignees, person.value) })}
        />
      ))}
    </div>
  );

  /* ── 줄 세우기 ── */
  const activeSorts = filters.sorts?.length
    ? filters.sorts
    : filters.sortKey
      ? [{ columnKey: filters.sortKey, direction: filters.sortDir }]
      : [];
  const setSorts = (sorts: { columnKey: string; direction: "asc" | "desc" }[]) =>
    patch({ sortKey: "", sortDir: "asc", sorts });
  const sortContent = (
    <div className="flex max-w-lg flex-col gap-0.5">
      <RadioOption label="원래 순서" checked={activeSorts.length === 0} onPick={() => setSorts([])} />
      {columns.map((column) => {
        const options = columnSortOptions(column);
        if (options.length === 0) return null;
        const index = activeSorts.findIndex((sort) => sort.columnKey === column.key);
        const current = index >= 0 ? activeSorts[index] : null;
        return (
          <div key={column.id} data-sort-column={column.key} className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg px-2 hover:bg-mw-bg">
            <span className={`min-w-0 flex-1 truncate text-xs ${current ? "font-semibold text-mw-record" : "text-mw-body"}`}>
              {current && activeSorts.length > 1 ? `${index + 1}. ` : ""}{column.label}
            </span>
            {options.map((option) => {
              const on = current?.direction === option.direction;
              return (
                <button
                  key={option.direction}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${column.label} ${option.label}`}
                  onClick={() => setSorts(on
                    ? activeSorts.filter((sort) => sort.columnKey !== column.key)
                    : current
                      ? activeSorts.map((sort) => sort.columnKey === column.key ? { ...sort, direction: option.direction } : sort)
                      : [...activeSorts, { columnKey: column.key, direction: option.direction }])}
                  className={`h-7 shrink-0 rounded-full border px-2.5 text-xs ${on ? "border-mw-record bg-mw-tint-blue font-semibold text-mw-record" : "border-mw-line bg-mw-card text-mw-body hover:border-mw-sub"}`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );

  /* ── 나눠 보기 ── */
  const groupContent = (
    <div className="flex max-w-sm flex-col gap-0.5">
      <RadioOption label="보드별로 나눠 보기" checked={groupBy === ""} onPick={() => onGroupBy?.("")} />
      {groupByOptions.map((option) => (
        <RadioOption
          key={option.key}
          label={`${option.label}별로 나눠 보기`}
          checked={groupBy === option.key}
          onPick={() => onGroupBy?.(option.key)}
        />
      ))}
    </div>
  );

  /* ── 보이는 칸 ── */
  const visibleColumnKeys = filters.visibleColumnKeys ?? null;
  const selectedColumnKeys = visibleColumnKeys === null ? columns.map((column) => column.key) : visibleColumnKeys;
  const columnsContent = (
    <div className="flex max-w-sm flex-col gap-0.5">
      <RadioOption
        label={`모두 보기 (${columns.length})`}
        checked={visibleColumnKeys === null}
        onPick={() => patch({ columnLimit: 0, visibleColumnKeys: null })}
      />
      <div role="separator" className="my-1 border-t border-mw-line" />
      {columns.map((column) => (
        <CheckOption
          key={column.id}
          label={column.label}
          checked={selectedColumnKeys.includes(column.key)}
          onToggle={() => {
            const next = toggle(selectedColumnKeys, column.key);
            patch({ columnLimit: 0, visibleColumnKeys: next.length === columns.length ? null : next });
          }}
        />
      ))}
    </div>
  );

  const content = tab === "filter"
    ? filterContent
    : tab === "assignee"
      ? assigneeContent
      : tab === "sort"
        ? sortContent
        : tab === "group"
          ? groupContent
          : columnsContent;

  const tabList = (
    <div
      role="tablist"
      aria-label="보기 조건"
      aria-orientation={sheet ? "horizontal" : "vertical"}
      className={sheet
        ? "mw-board-inline-scroll flex shrink-0 gap-1 overflow-x-auto overflow-y-hidden border-b border-mw-line pb-2"
        : "flex w-28 shrink-0 flex-col gap-0.5 border-e border-mw-line pe-2"}
    >
      {!sheet ? <span className="px-2 pb-1 text-[11px] font-semibold text-mw-sub">보기 조건</span> : null}
      {CONDITION_TABS.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="tab"
          id={`view-condition-tab-${entry.id}${sheet ? "-sheet" : ""}`}
          aria-selected={tab === entry.id}
          aria-controls={`view-condition-panel${sheet ? "-sheet" : ""}`}
          onClick={() => onTab(entry.id)}
          className={`h-8 shrink-0 rounded-[var(--mw-r-2)] px-2 text-left text-[length:var(--fs-13)] ${tab === entry.id ? "bg-mw-tint-blue font-semibold text-mw-record" : "text-mw-body hover:bg-mw-bg"}`}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );

  if (sheet) {
    return (
      <div className="flex min-h-0 flex-col gap-2">
        {tabList}
        <div
          id="view-condition-panel-sheet"
          role="tabpanel"
          aria-labelledby={`view-condition-tab-${tab}-sheet`}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {content}
        </div>
        {footer}
      </div>
    );
  }

  return (
    <div
      id="board-filter-panel"
      data-board-filter-panel
      className="relative flex gap-3 rounded-md border border-mw-line bg-mw-card p-3"
    >
      {tabList}
      <div
        id="view-condition-panel"
        role="tabpanel"
        aria-labelledby={`view-condition-tab-${tab}`}
        className="min-w-0 flex-1 pe-8"
      >
        {content}
      </div>
      {onClose ? (
        <button
          type="button"
          aria-label="보기 조건 닫기"
          onClick={onClose}
          className="absolute end-2 top-2 grid size-8 place-items-center rounded-[var(--mw-r-2)] text-mw-sub hover:bg-mw-bg hover:text-mw-fg"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
