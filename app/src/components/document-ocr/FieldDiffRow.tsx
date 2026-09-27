"use client";

import { OCR_FIELD_LABEL, type OcrFieldKey } from "@/lib/document-ocr/types";
import type { OcrFieldState } from "@/lib/document-ocr/apply-adapter";
import styles from "./field-diff-row.module.css";

export type FieldDiffRowProps = {
  state: OcrFieldState;
  disabled?: boolean;
  fieldError?: string;
  onToggle: (key: OcrFieldKey, checked: boolean) => void;
  onEdit: (key: OcrFieldKey, value: string) => void;
  onConfirm?: (key: OcrFieldKey, confirmed: boolean) => void;
};

function confidenceText(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export function FieldDiffRow({
  state,
  disabled,
  fieldError,
  onToggle,
  onEdit,
  onConfirm,
}: FieldDiffRowProps) {
  const { field, current, edited, checked } = state;
  const unsupported = Boolean(state.disabled);
  const same = edited.trim() !== "" && edited.trim() === current.trim();
  const needsReview = field.confidence < 0.5 || field.warnings.length > 0;
  const inputId = `ocr-field-${field.key}`;
  const warnId = `ocr-warn-${field.key}`;
  const describedBy =
    field.warnings.length > 0 || fieldError || state.disabledReason ? warnId : undefined;
  return (
    <li className={styles.row} data-field={field.key} data-unsupported={unsupported ? "true" : "false"}>
      <label
        className={styles.check}
        title={unsupported ? (state.disabledReason ?? "지원하지 않는 필드") : "이 필드를 확정 반영에 포함"}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled || unsupported}
          onChange={(e) => onToggle(field.key, e.target.checked)}
          aria-label={`${OCR_FIELD_LABEL[field.key]} 반영 포함`}
        />
      </label>
      <div className={styles.body}>
        <div className={styles.head}>
          <span className={styles.label}>{OCR_FIELD_LABEL[field.key]}</span>
          <span
            className={styles.confidence}
            data-low={field.confidence < 0.5 ? "true" : "false"}
            title={field.value ? "OCR 제안 확신도(경험치)" : "미추출"}
          >
            {field.value ? confidenceText(field.confidence) : "없음"}
          </span>
          {same && <span className={styles.same}>기존과 동일</span>}
          {needsReview && field.value && (
            <span className={styles.review}>확인 필요</span>
          )}
        </div>
        <div className={styles.cols}>
          <div className={styles.col}>
            <span className={styles.colLabel}>현재</span>
            <span className={styles.current}>{current || "—"}</span>
          </div>
          <div className={styles.col}>
            <label className={styles.colLabel} htmlFor={inputId}>
              제안 (편집 가능)
            </label>
            <input
              id={inputId}
              className={styles.proposed}
              value={edited}
              disabled={disabled}
              placeholder={field.value ? undefined : "미추출 — 비워 두면 기존값 유지"}
              onChange={(e) => onEdit(field.key, e.target.value)}
              aria-describedby={describedBy}
              aria-invalid={fieldError ? true : undefined}
            />
          </div>
        </div>
        {state.needsConfirm && !unsupported && (
          <label className={styles.confirm}>
            <input
              type="checkbox"
              checked={state.confirmed === true}
              disabled={disabled}
              onChange={(e) => onConfirm?.(field.key, e.target.checked)}
              aria-label={`${OCR_FIELD_LABEL[field.key]} 확정 확인 (체크섬 통과한 번호를 저장)`}
            />
            체크섬 통과 — 이 번호가 맞으면 확정 확인에 체크하세요
          </label>
        )}
        {(field.warnings.length > 0 || fieldError || state.disabledReason) && (
          <p id={warnId} className={styles.warnings} role={fieldError ? "alert" : undefined}>
            {fieldError && <span className={styles.error}>{fieldError}</span>}
            {state.disabledReason && (
              <span className={styles.warn}>지원 안함 — {state.disabledReason}</span>
            )}
            {field.warnings.map((w) => (
              <span key={w} className={styles.warn}>
                {w}
              </span>
            ))}
          </p>
        )}
      </div>
    </li>
  );
}
