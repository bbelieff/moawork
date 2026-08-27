import {
  OTHER_INFO_KEYS,
  OTHER_INFO_LABELS,
  checkedOtherInfoCount,
  otherInfoCountLabel,
  projectOtherInfoValue,
  type OtherInfoLegacyInput,
} from "@/lib/boards/structured-field";
import type { Ref } from "react";

export interface OtherInfoCellProps {
  value: unknown;
  legacy?: OtherInfoLegacyInput;
  readOnly?: boolean;
  error?: string | null;
  onOpen?: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}

export function OtherInfoCell({
  value,
  legacy,
  readOnly = false,
  error,
  onOpen,
  buttonRef,
}: OtherInfoCellProps) {
  const projection = projectOtherInfoValue(value, legacy);
  const count = checkedOtherInfoCount(value, legacy);
  const label = otherInfoCountLabel(value, legacy);
  const checkedLabels = OTHER_INFO_KEYS
    .filter((key) => projection.value[key].checked)
    .map((key) => OTHER_INFO_LABELS[key]);
  const accessibleLabel = checkedLabels.length > 0
    ? `기타정보 ${label}: ${checkedLabels.join(", ")}`
    : `기타정보 ${label}`;
  const content = (
    <>
      <span className="font-semibold tabular-nums">{label}</span>
      {count > 0 ? <span className="truncate text-[0.68rem] text-mw-sub">{checkedLabels.join(" · ")}</span> : null}
    </>
  );

  if (readOnly || !onOpen) {
    return (
      <span
        aria-label={accessibleLabel}
        data-invalid={error ? true : undefined}
        title={checkedLabels.join(", ") || undefined}
        className="flex h-7 min-w-0 items-center gap-1.5 px-2 text-xs text-mw-body"
      >
        {content}
        {error ? <span role="alert" className="sr-only">{error}</span> : null}
      </span>
    );
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={`${accessibleLabel} 편집`}
      aria-haspopup="dialog"
      data-invalid={error ? true : undefined}
      title={checkedLabels.join(", ") || undefined}
      onClick={onOpen}
      className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded px-2 text-left text-xs text-mw-body hover:bg-mw-bg focus:outline-none focus:ring-2 focus:ring-mw-primary/25"
    >
      {content}
      {error ? <span role="alert" className="sr-only">{error}</span> : null}
    </button>
  );
}
