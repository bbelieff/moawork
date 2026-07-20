"use client";

// T09 · 선택지 셀렉트 — 정책자금 프리셋 카테고리 옵션을 렌더한다.
// 데이터 소스 무관(props). region(218) 등 큰 목록도 네이티브 select 로 처리.

import type { OptionCategory, PresetOption } from "@/lib/policyfund";

export interface OptionSelectProps {
  category: OptionCategory;
  value?: string;
  onChange?: (value: string) => void;
  /** 미선택 시 표시할 placeholder(라벨). */
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}

/** 단일 카테고리 드롭다운. 라벨 + 옵션 개수 뱃지 포함. */
export function OptionSelect({
  category,
  value,
  onChange,
  placeholder,
  disabled,
  id,
}: OptionSelectProps) {
  const selectId = id ?? `optsel-${category.id}`;
  return (
    <label htmlFor={selectId} className="flex flex-col gap-1 text-sm">
      <span className="flex items-center gap-2 font-medium">
        {category.label}
        <span className="rounded-full bg-black/[.06] px-2 py-0.5 text-xs text-zinc-600 dark:bg-white/[.1] dark:text-zinc-300">
          {category.options.length}
        </span>
      </span>
      <select
        id={selectId}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)}
        className="h-9 rounded-md border border-black/15 bg-transparent px-2 text-sm disabled:opacity-50 dark:border-white/20"
      >
        <option value="">{placeholder ?? "선택"}</option>
        {category.options.map((opt: PresetOption) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
