"use client";

import type { ItemWithValues } from "@/lib/boards/types";
import {
  OTHER_INFO_KEYS,
  OTHER_INFO_LABELS,
  otherInfoFacetFilterKey,
  otherInfoFacetState,
  otherInfoLegacyFromValues,
  type OtherInfoFacetState,
  type OtherInfoKey,
} from "@/lib/boards/structured-field";
import { CheckOption, FilterChip } from "./FilterChip";
import type { BoardFilterState } from "./filters";

const STATES: readonly { id: OtherInfoFacetState; label: string }[] = [
  { id: "missing", label: "값 없음" },
  { id: "false", label: "미체크" },
  { id: "true", label: "체크" },
];

function toggle(values: readonly string[], value: OtherInfoFacetState): string[] {
  return values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value];
}

function countsFor(rows: readonly ItemWithValues[], columnKey: string, key: OtherInfoKey): Record<OtherInfoFacetState, number> {
  const counts: Record<OtherInfoFacetState, number> = { missing: 0, false: 0, true: 0 };
  for (const row of rows) {
    const state = otherInfoFacetState(
      row.values[columnKey] ?? null,
      key,
      columnKey === "other_info" ? otherInfoLegacyFromValues(row.values) : undefined,
    );
    counts[state] += 1;
  }
  return counts;
}

export function OtherInfoFacetFilters({
  rows,
  columnKey,
  columnLabel,
  qualifyLabel = false,
  filters,
  onChange,
}: {
  rows: readonly ItemWithValues[];
  columnKey: string;
  columnLabel: string;
  qualifyLabel?: boolean;
  filters: BoardFilterState;
  onChange(next: BoardFilterState): void;
}) {
  const patch = (key: OtherInfoKey, picked: string[]) => {
    const filterKey = otherInfoFacetFilterKey(columnKey, key);
    onChange({
      ...filters,
      byColumn: { ...filters.byColumn, [filterKey]: picked },
    });
  };

  return OTHER_INFO_KEYS.map((key) => {
    const filterKey = otherInfoFacetFilterKey(columnKey, key);
    const picked = filters.byColumn[filterKey] ?? [];
    const counts = countsFor(rows, columnKey, key);
    return (
      <FilterChip
        key={key}
        label={qualifyLabel ? `${columnLabel} · ${OTHER_INFO_LABELS[key]}` : OTHER_INFO_LABELS[key]}
        summary={picked.length === 1 ? STATES.find((state) => state.id === picked[0])?.label : picked.length > 1 ? `${picked.length}개` : undefined}
        active={picked.length > 0}
        onClear={() => patch(key, [])}
      >
        {STATES.map((state) => (
          <CheckOption
            key={state.id}
            label={`${state.label} (${counts[state.id]})`}
            checked={picked.includes(state.id)}
            onToggle={() => patch(key, toggle(picked, state.id))}
          />
        ))}
      </FilterChip>
    );
  });
}
