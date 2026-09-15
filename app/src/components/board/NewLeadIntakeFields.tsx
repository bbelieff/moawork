"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  NEW_LEAD_BUSINESS_TYPES,
  NEW_LEAD_CUSTOM_BUSINESS_TYPE,
} from "@/lib/new-lead/business-types";
import { NEW_LEAD_REVENUE_BANDS, NEW_LEAD_CUSTOM_REVENUE_LABEL } from "@/lib/new-lead/revenue-bands";
import {
  formatRevenueInput,
  REVENUE_UNIT_LABEL,
  REVENUE_YEAR_FIELDS,
} from "@/lib/new-lead/revenue-years";
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

/*
 * #673 — 「개인사업자, 법인사업자, 그외 세개중 선택하게 하고 그외를 선택한 경우
 *        자유작성 필드를 옆에 만들어줘」
 *
 * 전에는 datalist 를 단 «자유입력» 이었다. 그래서 아무 글자나 들어갔고 —
 * 「개인」·「법인사업자 」·「개읺사업자」가 다 다른 값이 됐다. 그러면 나중에
 * 「개인사업자만 보기」 같은 것을 할 수 없다. 게다가 추천 목록에서 「그외」를
 * 빼 버려서, 정작 자유작성이 필요한 갈래로 갈 길이 없었다.
 *
 * ★ 「그외 → 옆 칸」 은 같은 파일의 RevenueBandField 가 이미 쓰는 모양이다.
 *   화면 안에서 두 필드가 서로 다르게 동작하면 그게 학습 비용이다.
 */
export function BusinessTypeField({ invalid = false }: { invalid?: boolean }) {
  const [selected, setSelected] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const reset = useCallback(() => setSelected(""), []);
  useReset(rootRef, reset);
  return (
    <div ref={rootRef} className="grid gap-1 sm:grid-cols-[1fr_1fr] sm:items-end sm:gap-2">
      <label className="grid gap-1 text-xs text-mw-sub">
        <span>사업자유형 <span aria-label="필수" className="font-semibold text-mw-error">*</span></span>
        <select
          name="business_registration_type"
          required
          aria-required="true"
          aria-invalid={invalid}
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          className={`${CONTROL} aria-[invalid=true]:border-mw-error`}
        >
          <option value="">고르세요</option>
          {NEW_LEAD_BUSINESS_TYPES.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </label>
      {selected === NEW_LEAD_CUSTOM_BUSINESS_TYPE ? (
        <label className="grid gap-1 text-xs text-mw-sub">
          <span>어떤 유형인가요 <span aria-label="필수" className="font-semibold text-mw-error">*</span></span>
          <input
            name="business_registration_type_custom"
            required
            className={CONTROL}
            placeholder="예: 비영리법인 · 협동조합"
          />
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
          {NEW_LEAD_REVENUE_BANDS.map((value) => <option key={value} value={value}>{value === "그외" ? NEW_LEAD_CUSTOM_REVENUE_LABEL : value}</option>)}
        </select>
      </label>
      {selected === "그외" ? (
        <label className="grid gap-1 text-xs text-mw-sub">
          <span>정확한 매출액 <span aria-label="필수" className="font-semibold text-mw-error">*</span></span>
          <input name="revenue_band_custom" required className={CONTROL} placeholder="예: 2억 5,000만원" />
        </label>
      ) : null}
    </div>
  );
}

/*
 * #673 — 「'매출'로 이름 바꾸고 칸을 4개 만들어줘 Y-현재, Y-1,Y-2,Y-3 필드 넣고
 *        천단위로 콤마, 백만원 될 수 있게 해서 매출에 4개 필드가 물리게 해줘」
 *
 * 전에는 「3개년매출(백만원)」 숫자 한 칸이었다. 그 칸이 3년 합계인지 작년치인지 평균인지
 * 알 수 없어서, 적는 사람마다 다르게 적으면 그 숫자는 비교할 수 없었다.
 *
 * ★ 콤마는 적는 «도중에» 따라온다. 못 읽는 글자는 버리지 않고 그대로 둔다 —
 *   적던 것이 사라지면 놀란다.
 */
export function RevenueYearsField() {
  const [values, setValues] = useState<Record<string, string>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const reset = useCallback(() => setValues({}), []);
  useReset(rootRef, reset);
  return (
    <div ref={rootRef} className="grid gap-1">
      <span className="text-xs text-mw-sub">
        매출 <span className="text-mw-sub">({REVENUE_UNIT_LABEL})</span>
      </span>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {REVENUE_YEAR_FIELDS.map((field) => (
          <label key={field.key} className="grid gap-1 text-xs text-mw-sub">
            {field.label}
            <input
              name={field.key}
              inputMode="numeric"
              autoComplete="off"
              value={values[field.key] ?? ""}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.key]: event.target.value }))
              }
              onBlur={(event) =>
                setValues((current) => ({
                  ...current,
                  [field.key]: formatRevenueInput(event.target.value),
                }))
              }
              className={CONTROL}
              placeholder="0"
            />
          </label>
        ))}
      </div>
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
