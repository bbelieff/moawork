"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  applyOcrResultToStates,
  buildApplyPayload,
  defaultChecked,
  newOcrRequestId,
  type OcrFieldState,
} from "@/lib/document-ocr/apply-adapter";
import { createOcrRunGate, OCR_LIMITS } from "@/lib/document-ocr/limits";
import type { OcrProgress } from "@/lib/document-ocr/types";
import { parseCertificateText } from "@/lib/document-ocr/parse-certificate";
import {
  OCR_FIELD_KEYS,
  OCR_STAGE_LABEL,
  type OcrApplyHandler,
  type OcrApplyRequest,
  type OcrFieldKey,
} from "@/lib/document-ocr/types";
import { FieldDiffRow } from "./FieldDiffRow";
import styles from "./document-ocr-modal.module.css";

export type DocumentOcrModalProps = {
  /** 부모가 여는 상태. false가 되면 닫힌다. */
  open: boolean;
  /** 현재 보드 값 (비교 기준). 없는 키는 "" 취급. */
  current: Partial<Record<OcrFieldKey, string>>;
  /** OCR 키 → 보드 컬럼/상세 키. 부모의 권한 확인 저장과 연결된다. */
  fieldMap: Partial<Record<OcrFieldKey, string>>;
  onApply: OcrApplyHandler;
  onClose: () => void;
  title?: string;
  /**
   * 제안값 변환 (예: 과세 라벨 → 사업자유형 전체 문자열).
   * unsupportedReason을 돌려주면 그 행은 선택 불가 + 사유 표시가 된다.
   */
  suggest?: (
    key: OcrFieldKey,
    proposed: string,
    currentValue: string,
  ) => { value: string; warnings?: string[]; unsupportedReason?: string };
  /** 매핑 없는 키의 선택 불가 사유. 없으면 기본 문구를 쓴다. */
  unsupportedReason?: (key: OcrFieldKey) => string | undefined;
  /**
   * true를 돌려준 키는 반영 체크와 별도로 명시 확정이 필요하다
   * (사업자등록번호 — 체크섬 통과와 사용자 확정 확인이 함께 있어야 저장).
   */
  requireConfirm?: (key: OcrFieldKey) => boolean;
};

type Phase = "pick" | "running" | "diff";

export function DocumentOcrModal({
  open,
  current,
  fieldMap,
  onApply,
  onClose,
  title = "사업자등록증 OCR 확인",
  suggest,
  unsupportedReason,
  requireConfirm,
}: DocumentOcrModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [gate] = useState(() => createOcrRunGate());
  const headingId = useId();
  const descId = useId();

  const [phase, setPhase] = useState<Phase>("pick");
  const [fileName, setFileName] = useState("");
  const [fileKind, setFileKind] = useState<"image" | "pdf" | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [runError, setRunError] = useState("");
  const [sourceKind, setSourceKind] = useState<"ocr" | "pdf-text" | null>(null);
  const [docWarnings, setDocWarnings] = useState<string[]>([]);
  const [states, setStates] = useState<OcrFieldState[]>([]);
  const [applyErrors, setApplyErrors] = useState<Partial<Record<OcrFieldKey, string>>>({});
  const [applyMessage, setApplyMessage] = useState("");
  const [applyNotice, setApplyNotice] = useState("");
  const [applying, setApplying] = useState(false);
  const [requestId, setRequestId] = useState("");

  const revokePreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  const resetAll = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    revokePreview();
    setPhase("pick");
    setFileName("");
    setFileKind(null);
    setPreviewUrl(null);
    setProgress(null);
    setRunError("");
    setSourceKind(null);
    setDocWarnings([]);
    setStates([]);
    setApplyErrors({});
    setApplyMessage("");
    setApplyNotice("");
    setApplying(false);
    setRequestId("");
  }, [revokePreview]);

  // 네이티브 dialog 생명주기: open prop ↔ showModal 동기화, Esc는 onClose.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      resetAll();
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, resetAll]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      abortRef.current?.abort();
      onClose();
    };
    const onCloseNative = () => {
      abortRef.current?.abort();
      revokePreview();
    };
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onCloseNative);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onCloseNative);
    };
  }, [onClose, revokePreview]);

  // 모달이 열리면 제목으로 포커스 (접근성).
  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => {
        document
          .getElementById(headingId)
          ?.setAttribute("tabindex", "-1");
        document.getElementById(headingId)?.focus({ preventScroll: true });
      }, 0);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open, headingId]);

  // 언마운트 시 뒷정리 — 진행 중 인식도 중단한다 (미해결 promise 방지).
  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
      revokePreview();
    },
    [revokePreview],
  );

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      abortRef.current?.abort();
      revokePreview();
      setRunError("");
      setApplyErrors({});
      setApplyMessage("");
      setApplyNotice("");
      const kind = file.type === "application/pdf" || /\.pdf$/i.test(file.name) ? "pdf" : "image";
      const url = URL.createObjectURL(file);
      previewUrlRef.current = url;
      setPreviewUrl(url);
      setFileKind(kind);
      setFileName(file.name);
      setPhase("running");
      setProgress({ stage: "validating", ratio: 0.02, message: "파일 확인 중" });
      const controller = new AbortController();
      abortRef.current = controller;
      // 실행 세대 토큰 — 이전 실행의 뒤늦은 완료가 새 화면을 덮지 않게 한다.
      const runToken = gate.start();
      // 문서 세션별 고정 ID — 같은 의도의 재시도는 바꾸지 않는다.
      // 제안 내용을 새로 고치면(edit) 새 ID를 발급한다.
      setRequestId(newOcrRequestId());
      try {
        const { runDocumentOcr } = await import("@/lib/document-ocr/ocr-client");
        const engine = await runDocumentOcr(file, {
          signal: controller.signal,
          onProgress: (p) => {
            if (gate.isCurrent(runToken) === false) return;
            setProgress(p);
          },
        });
        // 재오픈으로 세대가 바뀌었으면 늦게 온 결과는 버린다 (상태 오염 방지).
        if (gate.isCurrent(runToken) === false) return;
        setProgress({ stage: "parsing", ratio: 0.95, message: "필드 추출 중" });
        const parsed = parseCertificateText(engine.text);
        // 엔진이 PDF 텍스트층을 직접 줬으면 출처를 그대로 표기한다.
        setSourceKind(engine.sourceKind);
        setDocWarnings(parsed.documentWarnings);
        setStates(
          OCR_FIELD_KEYS.map((key) => {
            const field = parsed.fields[key];
            const cur = (current[key] ?? "").toString();
            // 부모 변환 (예: 과세 라벨 → 사업자유형 전체 문자열).
            const converted = suggest?.(key, field.value, cur);
            const unsupported =
              converted?.unsupportedReason ??
              (fieldMap[key] ? undefined : unsupportedReason?.(key) ?? "보드 매핑이 없어 저장하지 않습니다.");
            const mergedField = converted
              ? {
                  ...field,
                  value: converted.value,
                  warnings: [...field.warnings, ...(converted.warnings ?? [])],
                }
              : { ...field, value: field.value };
            if (unsupported) {
              return {
                field: mergedField,
                current: cur,
                edited: mergedField.value,
                checked: false,
                disabled: true,
                disabledReason: unsupported,
              };
            }
            // 명시 확정 행은 체크돼도 확정 확인 없이는 보내지 않는다.
            const needsConfirm = requireConfirm?.(key) === true;
            return {
              field: mergedField,
              current: cur,
              edited: mergedField.value,
              checked: defaultChecked(mergedField, cur),
              ...(needsConfirm ? { needsConfirm: true as const, confirmed: false as const } : {}),
            };
          }),
        );
        setPhase("diff");
        setProgress({ stage: "done", ratio: 1, message: "완료" });
      } catch (error) {
        // 이전 세대의 취소·실패가 새 실행 화면을 덮지 않게 한다.
        if (gate.isCurrent(runToken) === false) return;
        if (controller.signal.aborted) {
          setRunError("취소했습니다. 같은 파일로 다시 시도할 수 있습니다.");
        } else {
          setRunError(
            error instanceof Error ? error.message : "문서를 읽지 못했습니다.",
          );
        }
        setPhase("pick");
        setProgress(null);
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [current, fieldMap, suggest, unsupportedReason, requireConfirm, revokePreview, gate],
  );

  const handleCancelRun = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // X·닫기는 진행 중 인식도 함께 중단한다 (worker 정리·미해결 promise 방지).
  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    onClose();
  }, [onClose]);

  const toggle = useCallback((key: OcrFieldKey, checked: boolean) => {
    setStates((prev) =>
      prev.map((s) =>
        s.field.key === key && !s.disabled ? { ...s, checked } : s,
      ),
    );
  }, []);

  const confirm = useCallback((key: OcrFieldKey, confirmed: boolean) => {
    setStates((prev) =>
      prev.map((s) =>
        s.field.key === key && s.needsConfirm ? { ...s, confirmed } : s,
      ),
    );
  }, []);

  const edit = useCallback((key: OcrFieldKey, value: string) => {
    setStates((prev) =>
      prev.map((s) =>
        // 값을 고치면 명시 확정도 리셋된다 — 새 값에 대한 새 확정.
        s.field.key === key ? { ...s, edited: value, confirmed: false } : s,
      ),
    );
    // 제안 내용을 새로 고치면 새 의도 → 새 requestId (재시도 멱등 분리).
    setRequestId(newOcrRequestId());
    setApplyErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const toggleAll = useCallback((checked: boolean) => {
    // 선택 불가(미지원) 행은 건드리지 않는다.
    setStates((prev) => prev.map((s) => (s.disabled ? s : { ...s, checked })));
  }, []);

  const handleApply = useCallback(async () => {
    const payload = buildApplyPayload({ states, fieldMap });
    if (payload.selections.length === 0) {
      const notes = [
        ...payload.skippedBlank.map(() => "빈 제안(기존값 유지)"),
        ...payload.blockedInvalid.map(() => "형식 오류(먼저 수정)"),
        ...payload.unmapped.map(() => "보드 매핑 없음"),
        ...payload.unconfirmed.map(() => "확정 확인 필요"),
      ];
      setApplyNotice(
        notes.length > 0
          ? `반영할 선택이 없습니다 — ${notes.join(" · ")}. 체크하거나 제안값을 고쳐 주세요.`
          : "반영할 선택이 없습니다. 체크박스로 포함할 필드를 고르세요.",
      );
      return;
    }
    setApplying(true);
    setApplyNotice("");
    setApplyMessage("");
    const request: OcrApplyRequest = {
      requestId,
      selections: payload.selections.map((s) => ({
        fieldKey: s.fieldKey,
        value: s.value,
        confirmed: s.confirmed,
      })),
    };
    try {
      const result = await onApply(request);
      setApplyErrors(result.fieldErrors);
      const failedKeys = Object.keys(result.fieldErrors) as OcrFieldKey[];
      const applied: Partial<Record<OcrFieldKey, string>> = {};
      for (const selection of payload.selections) {
        if (!result.fieldErrors[selection.fieldKey]) {
          applied[selection.fieldKey] = selection.value;
        }
      }
      // 성공분은 선택 해제 + 기존값 갱신 (재저장 방지), 실패 초안만 유지.
      // 같은 의도의 재시도는 requestId를 바꾸지 않는다.
      setStates((prev) => applyOcrResultToStates(prev, applied, result.fieldErrors));
      const excludedCount = states.filter((s) => s.disabled).length;
      const excludedNote =
        excludedCount > 0 ? ` 미지원 ${excludedCount}개는 저장하지 않았습니다(사유는 각 행 참조).` : "";
      if (result.ok) {
        const skipped =
          payload.skippedBlank.length > 0
            ? ` (빈 제안 ${payload.skippedBlank.length}개는 기존값 유지)`
            : "";
        setApplyMessage(
          `선택한 ${payload.selections.length}개를 반영했습니다.${skipped}${excludedNote}`,
        );
      } else {
        // 실패해도 편집·선택 유지 — 고친 값 그대로 다시 시도 가능.
        setApplyMessage(
          (result.message ??
            `${failedKeys.length}개 실패. 성공분은 유지되고 실패분만 다시 시도하세요.`) +
            excludedNote,
        );
      }
      if (payload.skippedBlank.length > 0 && !result.ok) {
        setApplyNotice(
          `빈 제안 ${payload.skippedBlank.length}개는 기존값을 지키기 위해 보내지 않았습니다.`,
        );
      }
    } catch (error) {
      setApplyMessage(
        error instanceof Error
          ? `반영 중 오류: ${error.message} — 편집·선택은 그대로 두었습니다. 다시 시도하세요.`
          : "반영 중 오류 — 편집·선택은 그대로 두었습니다. 다시 시도하세요.",
      );
    } finally {
      setApplying(false);
    }
  }, [states, fieldMap, requestId, onApply]);

  const selectedCount = states.filter((s) => s.checked).length;

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={headingId}
      aria-describedby={descId}
    >
      <div className={styles.head}>
        <h2 id={headingId} className={styles.title}>
          {title}
        </h2>
        <button
          type="button"
          className={styles.close}
          onClick={handleClose}
          aria-label="닫기"
        >
          ✕
        </button>
      </div>
      <p id={descId} className={styles.localNote}>
        파일은 이 브라우저 안에서만 읽습니다. 외부 전송·자동 저장 없음. OCR 결과는
        제안이며, 체크한 필드만 직접 확인 후 반영됩니다.
      </p>

      {phase === "pick" && (
        <div className={styles.pick}>
          <label className={styles.fileLabel} htmlFor="ocr-file-input">
            사업자등록증 파일 선택 (JPEG·PNG·WebP·PDF 첫 페이지, 최대{" "}
            {OCR_LIMITS.maxFileBytes / 1024 / 1024}MB)
          </label>
          <input
            id="ocr-file-input"
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
          {runError && (
            <p className={styles.error} role="alert">
              {runError}
            </p>
          )}
        </div>
      )}

      {phase === "running" && (
        <div className={styles.running}>
          <p className={styles.fileName}>{fileName}</p>
          <div
            className={styles.progress}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((progress?.ratio ?? 0) * 100)}
            aria-label={progress ? OCR_STAGE_LABEL[progress.stage] : "진행 중"}
          >
            <div
              className={styles.bar}
              style={{ width: `${Math.round((progress?.ratio ?? 0) * 100)}%` }}
            />
          </div>
          <p className={styles.stage}>
            {progress ? `${OCR_STAGE_LABEL[progress.stage]}…` : "준비 중…"}
          </p>
          <button type="button" className={styles.ghost} onClick={handleCancelRun}>
            취소
          </button>
        </div>
      )}

      {phase === "diff" && (
        <>
          {previewUrl && (
            <div className={styles.preview}>
              {fileKind === "pdf" ? (
                <iframe src={previewUrl} title={`${fileName} 미리보기 (로컬)`} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt={`${fileName} 미리보기 (로컬)`} />
              )}
              <p className={styles.previewNote}>
                미리보기는 로컬 표시 전용입니다. PDF는 첫 페이지만 사용합니다.
                {sourceKind === "pdf-text" && " (PDF 텍스트층 직접 추출 — OCR 생략)"}
              </p>
            </div>
          )}
          {docWarnings.length > 0 && (
            <ul className={styles.docWarnings}>
              {docWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <div className={styles.selectRow}>
            <button type="button" className={styles.ghost} onClick={() => toggleAll(true)}>
              전체 선택
            </button>
            <button type="button" className={styles.ghost} onClick={() => toggleAll(false)}>
              전체 해제
            </button>
            <span className={styles.count}>{selectedCount}개 선택됨</span>
          </div>
          <ul className={styles.list}>
            {states.map((s) => (
              <FieldDiffRow
                key={s.field.key}
                state={s}
                disabled={applying}
                fieldError={applyErrors[s.field.key]}
                onToggle={toggle}
                onEdit={edit}
                onConfirm={confirm}
              />
            ))}
          </ul>
          {applyNotice && <p className={styles.notice}>{applyNotice}</p>}
          {applyMessage && (
            <p className={styles.message} role="status">
              {applyMessage}
            </p>
          )}
          <div className={styles.actions}>
            <label className={styles.repick}>
              다른 파일
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => void handleFile(e.target.files?.[0])}
                aria-label="다른 파일로 다시 시도"
              />
            </label>
            <button
              type="button"
              className={styles.primary}
              disabled={applying || selectedCount === 0}
              onClick={() => void handleApply()}
            >
              {applying ? "반영 중…" : `선택 ${selectedCount}개 반영`}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
