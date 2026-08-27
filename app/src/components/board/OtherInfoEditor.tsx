"use client";

import { useId, useMemo, type KeyboardEvent } from "react";
import {
  OTHER_INFO_KEYS,
  OTHER_INFO_LABELS,
  projectOtherInfoValue,
  updateOtherInfoEntry,
  type OtherInfoLegacyInput,
  type OtherInfoValue,
} from "@/lib/boards/structured-field";

export interface OtherInfoEditorProps {
  value: unknown;
  legacy?: OtherInfoLegacyInput;
  readOnly?: boolean;
  disabled?: boolean;
  error?: string | null;
  onChange: (value: OtherInfoValue) => void;
  onCommit?: (value: OtherInfoValue) => void;
  onCancel?: () => void;
}

export function OtherInfoEditor({
  value,
  legacy,
  readOnly = false,
  disabled = false,
  error,
  onChange,
  onCommit,
  onCancel,
}: OtherInfoEditorProps) {
  const id = useId();
  const draft = useMemo(() => projectOtherInfoValue(value, legacy).value, [legacy, value]);
  const locked = readOnly || disabled;

  const change = (next: OtherInfoValue) => {
    onChange(next);
  };

  const handleKeyboard = (event: KeyboardEvent<HTMLFieldSetElement>) => {
    if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && onCommit && !locked) {
      event.preventDefault();
      onCommit(draft);
    }
  };

  return (
    <fieldset
      aria-describedby={error ? `${id}-error` : undefined}
      aria-invalid={error ? true : undefined}
      aria-readonly={readOnly || undefined}
      onKeyDown={handleKeyboard}
      className="min-w-0 space-y-2"
    >
      <legend className="sr-only">기타정보</legend>
      {OTHER_INFO_KEYS.map((key) => {
        const entry = draft[key];
        const inputId = `${id}-${key}`;
        return (
          <div key={key} className="grid min-h-11 grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-2 rounded-lg border border-mw-line bg-mw-card px-3 py-2">
            <label className="flex min-h-7 items-center gap-2 text-xs font-medium text-mw-body">
              <input
                type="checkbox"
                checked={entry.checked}
                disabled={locked}
                onChange={(event) => change(updateOtherInfoEntry(draft, key, { checked: event.currentTarget.checked }))}
                className="h-4 w-4 shrink-0"
              />
              <span>{OTHER_INFO_LABELS[key]}</span>
            </label>
            <input
              id={inputId}
              type="text"
              value={entry.text}
              disabled={locked || !entry.checked}
              readOnly={readOnly}
              aria-label={`${OTHER_INFO_LABELS[key]} 내용`}
              aria-invalid={error ? true : undefined}
              onChange={(event) => change(updateOtherInfoEntry(draft, key, { text: event.currentTarget.value }))}
              placeholder={entry.checked ? "내용 입력" : "체크하면 입력할 수 있어요"}
              className="h-8 min-w-0 rounded-md border border-mw-line bg-mw-card px-2 text-xs text-mw-fg outline-none focus:border-mw-primary focus:ring-2 focus:ring-mw-primary/15 disabled:cursor-not-allowed disabled:bg-mw-bg disabled:text-mw-sub"
            />
          </div>
        );
      })}
      {error ? <p id={`${id}-error`} role="alert" className="text-xs text-mw-error">{error}</p> : null}
      {onCommit && !readOnly ? (
        <p className="text-[0.68rem] text-mw-sub">Ctrl/⌘ + Enter로 저장 · Esc로 닫기</p>
      ) : null}
    </fieldset>
  );
}
