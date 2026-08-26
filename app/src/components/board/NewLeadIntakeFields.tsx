"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { NEW_LEAD_BUSINESS_TYPES } from "@/lib/new-lead/business-types";
import { NEW_LEAD_REVENUE_BANDS } from "@/lib/new-lead/revenue-bands";
import {
  canonicalSido,
  searchSido,
  searchSigungu,
  type RegionSuggestion,
} from "@/lib/new-lead/region-search";
import { analyzePhone, formatPhone } from "@/lib/format/phone";

const CONTROL = "h-9 w-full rounded-lg border border-mw-line bg-mw-card px-2.5 text-xs text-mw-fg outline-none focus:border-mw-record";

function useReset(ref: RefObject<HTMLElement | null>, reset: () => void) {
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [ref, reset]);
}

export function BusinessTypeField({ invalid = false }: { invalid?: boolean }) {
  const [selected, setSelected] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const reset = useCallback(() => setSelected(""), []);
  useReset(rootRef, reset);
  return (
    <div ref={rootRef} className="grid gap-1">
      <label className="grid gap-1 text-xs text-mw-sub">
        <span>사업자 구분 <span aria-label="필수" className="font-semibold text-mw-error">*</span></span>
        <select name="business_registration_type" required aria-required="true" aria-invalid={invalid}
          value={selected} onChange={(event) => setSelected(event.target.value)}
          className={`${CONTROL} aria-[invalid=true]:border-mw-error`}>
          <option value="" disabled>선택하세요</option>
          {NEW_LEAD_BUSINESS_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      {selected === "그외" ? (
        <label className="grid gap-1 text-xs text-mw-sub">
          <span>그외 사업자 유형 <span aria-label="필수" className="font-semibold text-mw-error">*</span></span>
          <input name="business_registration_type_custom" required className={CONTROL} placeholder="예: 비영리법인" />
        </label>
      ) : null}
    </div>
  );
}

export function PhoneField({ invalid = false }: { invalid?: boolean }) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const reset = useCallback(() => setValue(""), []);
  useReset(inputRef, reset);
  const analysis = analyzePhone(value);
  return (
    <label className="grid gap-1 text-xs text-mw-sub">
      연락처
      <input ref={inputRef} name="phone" inputMode="tel" autoComplete="tel" value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => analysis.status === "normalized" && setValue(formatPhone(value))}
        aria-invalid={invalid || (value.length > 0 && analysis.status === "needs_review")}
        className={`${CONTROL} aria-[invalid=true]:border-mw-error`}
        placeholder="010-0000-0000" />
    </label>
  );
}

export function RevenueBandField({ invalid = false }: { invalid?: boolean }) {
  const [selected, setSelected] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const reset = useCallback(() => setSelected(""), []);
  useReset(rootRef, reset);
  return (
    <div ref={rootRef} className="grid gap-1">
      <label className="grid gap-1 text-xs text-mw-sub">3개년매출
        <select name="revenue_band" value={selected} onChange={(event) => setSelected(event.target.value)}
          aria-invalid={invalid} className={`${CONTROL} aria-[invalid=true]:border-mw-error`}>
          <option value="">미입력</option>
          {NEW_LEAD_REVENUE_BANDS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      {selected === "그외" ? (
        <label className="grid gap-1 text-xs text-mw-sub">
          <span>그외 매출 구간 <span aria-label="필수" className="font-semibold text-mw-error">*</span></span>
          <input name="revenue_band_custom" required className={CONTROL} placeholder="예: 9,000만원~1억" />
        </label>
      ) : null}
    </div>
  );
}

function RegionCombobox({ name, label, value, onValue, suggestions, disabled = false }: {
  name: string; label: string; value: string; onValue: (value: string) => void;
  suggestions: readonly RegionSuggestion[]; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const visible = suggestions.slice(0, 8);
  const listId = `${name}-suggestions`;
  const choose = (entry: RegionSuggestion) => {
    onValue(entry.value);
    setOpen(false);
    setActive(0);
  };
  return (
    <label className="relative grid gap-1 text-xs text-mw-sub">
      {label}
      <input ref={inputRef} name={name} value={value} disabled={disabled} autoComplete="off"
        role="combobox" aria-expanded={open && visible.length > 0} aria-controls={listId}
        aria-autocomplete="list" aria-activedescendant={open && visible[active] ? `${listId}-${active}` : undefined}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(event) => { onValue(event.target.value); setOpen(true); setActive(0); }}
        onKeyDown={(event) => {
          // 사용자가 초성을 친 직후 빠르게 Enter를 눌러도 React의 open 상태 갱신보다
          // 폼 submit이 먼저 나가면 안 된다. 화면에 추천이 있으면 선택을 항상 우선한다.
          if (event.key === "Enter" && visible[active]) { event.preventDefault(); choose(visible[active]); }
          if (visible.length === 0) return;
          if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive((current) => (current + 1) % visible.length); }
          if (event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setActive((current) => (current - 1 + visible.length) % visible.length); }
          if (event.key === "Escape") setOpen(false);
        }}
        className={`${CONTROL} disabled:bg-mw-bg disabled:text-mw-sub`}
        placeholder={disabled ? "시도를 먼저 선택하세요" : `${label} 또는 초성 검색`} />
      {open && visible.length > 0 ? (
        <ul id={listId} role="listbox" className="mw-layer-page-popover absolute left-0 right-0 top-[4.2rem] max-h-56 overflow-auto rounded-lg border border-mw-line bg-mw-card p-1 shadow-xl">
          {visible.map((entry, index) => (
            <li key={entry.value} id={`${listId}-${index}`} role="option" aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()} onClick={() => choose(entry)}
              className={`cursor-pointer rounded px-3 py-2 text-sm ${index === active ? "bg-mw-tint-blue text-mw-record" : "text-mw-fg hover:bg-mw-bg"}`}>
              {entry.label}
            </li>
          ))}
        </ul>
      ) : null}
    </label>
  );
}

export function RegionFields() {
  const [sido, setSido] = useState("");
  const [sigungu, setSigungu] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const sidoOptions = useMemo(() => searchSido(sido), [sido]);
  const sigunguOptions = useMemo(() => searchSigungu(sido, sigungu), [sido, sigungu]);
  const reset = useCallback(() => { setSido(""); setSigungu(""); }, []);
  useReset(rootRef, reset);
  return (
    <div ref={rootRef} className="contents">
      <RegionCombobox name="region_sido" label="시도" value={sido}
        onValue={(next) => { setSido(next); setSigungu(""); }} suggestions={sidoOptions} />
      <RegionCombobox name="region_sigungu" label="시군구" value={sigungu}
        onValue={setSigungu} suggestions={sigunguOptions} disabled={!canonicalSido(sido)} />
    </div>
  );
}
