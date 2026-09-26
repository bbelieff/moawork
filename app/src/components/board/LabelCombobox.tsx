"use client";

/**
 * 2026-09-26 — «라벨 검색 및 만들기» 공유 콤보박스 (월요일 사용자 요청).
 *
 * 일반 select/status/multiselect 셀과 일괄 선택에서 native select 대신 쓰는
 * 접근성 콤보박스다. 검색은 `filterLabelOptions`, 만들기 가능 여부는
 * `canCreateLabelForColumn`(서버가 최종 판정)으로 같은 눈을 쓴다.
 *
 *   · `role=combobox` + `listbox`, `aria-expanded`·`aria-activedescendant`
 *   · ↑↓ 이동, Enter 선택/만들기, Esc 닫기, 작은 화면 스크롤(`max-h` + overflow)
 *   · 만들기는 `canCreate && createLabel` 일 때만 행을 보여준다
 *     (컬럼 관리 권한이 없으면 검색·선택만 — 서버도 다시 막는다)
 *   · 충돌·실패해도 쿼리를 지우지 않는다 — 입력하던 것이 사라지지 않는다
 *   · 단일 정본: 선택지는 항상 컬럼 `options_jsonb`. 만든 값은 서버 저장 뒤
 *     `onCreated` 로 부모에 알려 revalidate 로 다른 셀도 갱신한다
 */

import { useId, useMemo, useRef, useState } from "react";
import { filterLabelOptions, normalizeLabelKey } from "@/lib/boards/label-options";

export type LabelComboOption = Readonly<{ id: string; label: string }>;

export type CreateLabelResult = Readonly<{
  ok: boolean;
  message: string;
  optionId?: string;
  conflict?: boolean;
}>;

export function LabelCombobox({
  options,
  value,
  multiple = false,
  name = "value",
  label,
  canCreate = false,
  createLabel,
  onCreated,
  onSelect,
  interceptChange,
  disabled = false,
  className,
}: {
  options: readonly LabelComboOption[];
  value: string | readonly string[] | null;
  multiple?: boolean;
  /** 셀 폼이 읽는 hidden input 이름 — 셀 저장은 기존 폼 계약 그대로다. */
  name?: string;
  label: string;
  /** 컬럼 관리 권한 + 가드 통과일 때만 true 로 넘긴다. 없으면 검색·선택만 된다. */
  canCreate?: boolean;
  createLabel?: (label: string) => Promise<CreateLabelResult>;
  /** 만들기 저장 뒤 — 부모가 revalidate 로 다른 셀을 갱신한다. */
  onCreated?: (optionId: string) => void;
  /**
   * 넘기면 폼 자동 제출 대신 이걸 부른다(일괄 대화상자처럼 폼이 없는 자리).
   * 단일: next id, 복수: next id 배열.
   */
  onSelect?: (next: string | string[]) => void;
  /** true 를 돌려주면 저장을 건너뛰고 표시를 되돌린다 — 낱개→일괄 가로채기. */
  interceptChange?: (nextValue: string) => boolean;
  disabled?: boolean;
  className?: string;
}) {
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [localOptions, setLocalOptions] = useState<{ snapshot: readonly LabelComboOption[]; created: readonly LabelComboOption[] } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // 컬럼 정의가 바뀌면(다른 셀 저장·revalidate) 그걸 따른다 — 만든 값 끼워넣기와 충돌 안 나게
  // «서버가 준 것 + 이번에 만든 것» 을 합친다.
  const merged = useMemo(() => {
    const ids = new Set(options.map((o) => o.id));
    const awaitingRefresh = localOptions?.snapshot === options ? localOptions.created : [];
    return [...options, ...awaitingRefresh.filter((o) => !ids.has(o.id))];
  }, [options, localOptions]);

  const propSelectedIds: readonly string[] = useMemo(() => {
    if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
    return typeof value === "string" && value !== "" ? [value] : [];
  }, [value]);
  /**
   * 복수 + 폼 제출 자리(onSelect 없음)는 로컬 선택을 들고 있는다.
   * 부모 value 는 저장·revalidate 뒤에야 바뀌므로, 토글→hidden→저장이 로컬에서 돈다.
   * onSelect 가 있으면 부모가 운전한다(일괄 대화상자).
   */
  const selectionKey = JSON.stringify(propSelectedIds);
  const [localMulti, setLocalMulti] = useState<{ source: string; values: string[] } | null>(null);
  const selectedIds: readonly string[] = onSelect || !multiple ? propSelectedIds : (localMulti?.source === selectionKey ? localMulti.values : propSelectedIds);

  const selectedLabel = useMemo(() => {
    if (multiple || selectedIds.length !== 1) return "";
    return merged.find((o) => o.id === selectedIds[0])?.label ?? selectedIds[0];
  }, [merged, selectedIds, multiple]);

  const filtered = useMemo(() => filterLabelOptions(merged, query), [merged, query]);
  const exactMatch = useMemo(
    () => merged.some((o) => normalizeLabelKey(o.label) === normalizeLabelKey(query)),
    [merged, query],
  );
  // 만들기 행은 «검색해도 없는 값 + 만들 권한» 일 때만 — 보호 컬럼·일반 편집자는 안 보인다.
  const showCreate = canCreate && typeof createLabel === "function" && query.trim() !== "" && !exactMatch && !multiple;
  const showCreateMulti = canCreate && typeof createLabel === "function" && query.trim() !== "" && !exactMatch && multiple;

  function submitSingle(id: string, clearQuery: boolean) {
    if (onSelect) {
      onSelect(id);
    } else {
      // hidden input 은 selectedIds(=부모 value)에서 그리므로, 부모가 re-render 하기 전
      // 제출값이 비는 것을 막기 위해 직접 값을 박고 제출한다.
      const form = inputRef.current?.form;
      if (form) {
        // jsdom 에는 CSS.escape 이 없다 — name 은 호출자가 정한 값이라 직접 비교로 찾는다.
        const hidden = [...form.querySelectorAll('input[type="hidden"]')].find(
          (entry) => entry instanceof HTMLInputElement && entry.name === name,
        ) as HTMLInputElement | undefined;
        if (hidden) hidden.value = id;
        form.requestSubmit();
      }
    }
    // ★ 충돌 실패는 쿼리를 지우지 않는다 — 입력하던 값이 사라지지 않는다.
    if (clearQuery) setQuery("");
    setOpen(false);
  }

  function pickSingle(id: string) {
    if (interceptChange?.(id)) {
      // 일괄 흐름으로 넘어갔다 — 표시는 원래 값으로 되돌린다.
      setQuery("");
      setOpen(false);
      return;
    }
    submitSingle(id, true);
  }

  function toggleMulti(id: string) {
    const next = selectedIds.includes(id) ? selectedIds.filter((entry) => entry !== id) : [...selectedIds, id];
    if (onSelect) {
      onSelect(next);
      return;
    }
    // 폼 제출은 저장 버튼이 한다 — hidden input 은 선택 상태에서 그려진다.
    setLocalMulti({ source: selectionKey, values: next });
  }

  async function create(queryLabel: string) {
    if (!createLabel || creating) return;
    setCreating(true);
    setMessage(null);
    try {
      const result = await createLabel(queryLabel);
      if (result.ok && result.optionId) {
        const created: LabelComboOption = { id: result.optionId, label: queryLabel.trim() };
        setLocalOptions((prev) => {
          const prior = prev?.snapshot === options ? prev.created : [];
          return { snapshot: options, created: prior.some((o) => o.id === created.id) ? prior : [...prior, created] };
        });
        onCreated?.(result.optionId);
        setMessage(result.message);
        if (multiple) {
          if (onSelect) onSelect([...selectedIds, result.optionId]);
          else setLocalMulti({ source: selectionKey, values: [...selectedIds, result.optionId] });
        } else {
          pickSingle(result.optionId);
          return;
        }
      } else if (result.conflict && result.optionId) {
        // ★ 충돌 실패 — 쿼리를 지우지 않고 기존값을 고른다.
        setMessage(result.message);
        if (multiple) {
          if (!selectedIds.includes(result.optionId)) {
            if (onSelect) onSelect([...selectedIds, result.optionId]);
            else setLocalMulti({ source: selectionKey, values: [...selectedIds, result.optionId] });
          }
        } else {
          submitSingle(result.optionId, false);
          return;
        }
      } else {
        // ★ 일반 실패 — 쿼리 그대로, 메시지만 보여준다.
        setMessage(result.message);
      }
    } catch {
      setMessage("라벨을 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setCreating(false);
    }
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const rows = filtered.length + (showCreate || showCreateMulti ? 1 : 0);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActive((prev) => rows === 0 ? 0 : (event.key === "ArrowDown" ? Math.min(prev + 1, rows - 1) : Math.max(prev - 1, 0)));
    } else if (event.key === "Enter") {
      const createRow = showCreate || showCreateMulti;
      if (open && active >= 0 && active < filtered.length) {
        event.preventDefault();
        const option = filtered[active];
        if (multiple) toggleMulti(option.id);
        else pickSingle(option.id);
      } else if (open && createRow && active === filtered.length) {
        event.preventDefault();
        void create(query);
      }
    } else if (event.key === "Escape") {
      // ★ Esc 는 닫기만 한다 — 입력값·선택을 버리지 않는다.
      event.preventDefault();
      setOpen(false);
    }
  }

  const activeId = open
    ? active < filtered.length
      ? `${listboxId}-${active}`
      : `${listboxId}-create`
    : undefined;

  return (
    <span className="block min-w-0">
      <span className="flex flex-wrap items-center gap-1">
        {multiple
          ? selectedIds.map((id) => (
              <span key={id} className="inline-flex max-w-full items-center gap-1 rounded bg-mw-tint-blue px-1.5 py-0.5 text-xs">
                <span className="truncate">{merged.find((o) => o.id === id)?.label ?? id}</span>
                {!onSelect ? <input type="hidden" name={name} value={id} /> : null}
                <button
                  type="button"
                  aria-label={`${merged.find((o) => o.id === id)?.label ?? id} 제거`}
                  disabled={disabled}
                  onClick={() => toggleMulti(id)}
                  className="text-mw-sub hover:text-mw-fg"
                >
                  ×
                </button>
              </span>
            ))
          : (
            <input type="hidden" name={name} value={Array.isArray(value) ? "" : (value ?? "")} />
          )}
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeId}
          aria-label={label}
          autoComplete="off"
          disabled={disabled || creating}
          placeholder={multiple ? "검색…" : selectedLabel || "검색…"}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={(event) => {
            // 팝업 안으로 포커스가 옮기면 닫지 않는다 — 버튼 클릭이 살아야 한다.
            if (!event.currentTarget.parentElement?.parentElement?.contains(event.relatedTarget as Node | null)) {
              setOpen(false);
            }
          }}
          onKeyDown={onInputKeyDown}
          className={className}
        />
      </span>
      {open ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={`${label} 선택지`}
          className="z-[var(--mw-layer-board-cell)] max-h-40 min-w-32 overflow-y-auto rounded-md border border-mw-line bg-mw-card shadow-lg"
        >
          {filtered.map((option, index) => (
            <li
              key={option.id}
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={multiple ? selectedIds.includes(option.id) : selectedIds[0] === option.id}
              className={`px-2 py-1 text-xs ${index === active ? "bg-mw-tint-blue" : ""}`}
            >
              <button
                type="button"
                tabIndex={-1}
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => (multiple ? toggleMulti(option.id) : pickSingle(option.id))}
                className="block w-full truncate text-left"
              >
                {selectedIds.includes(option.id) ? "✓ " : null}
                {option.label}
              </button>
            </li>
          ))}
          {(showCreate || showCreateMulti) ? (
            <li
              id={`${listboxId}-create`}
              role="option"
              aria-selected={false}
              className={`border-t border-mw-line px-2 py-1 text-xs ${active === filtered.length ? "bg-mw-tint-blue" : ""}`}
            >
              <button
                type="button"
                tabIndex={-1}
                disabled={disabled || creating}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void create(query)}
                className="block w-full truncate text-left font-semibold text-mw-primary"
              >
                {creating ? "만드는 중…" : `「${query.trim()}」 새로 만들기`}
              </button>
            </li>
          ) : null}
          {filtered.length === 0 && !(showCreate || showCreateMulti) ? (
            <li className="px-2 py-1 text-xs text-mw-sub">찾은 값이 없습니다</li>
          ) : null}
        </ul>
      ) : null}
      {multiple && !onSelect ? (
        <button type="submit" className="mt-1 rounded border border-mw-line px-2 py-0.5 text-[0.65rem] hover:bg-zinc-50 dark:hover:bg-zinc-900">
          {label} 저장
        </button>
      ) : null}
      {message ? (
        <p role="status" className="px-1.5 text-[0.65rem] text-mw-body">
          {message}
        </p>
      ) : null}
    </span>
  );
}
