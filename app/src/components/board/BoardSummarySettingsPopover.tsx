"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BoardColumn } from "@/lib/boards/types";
import {
  boardSummaryCandidates,
  normalizeBoardSummaryConfig,
  type BoardSummaryMetricConfig,
} from "@/lib/boards/summary";
import type { BoardSummarySettingsIntent, BoardSummarySettingsRequest } from "@/lib/boards/summary-settings";
export type { BoardSummarySettingsIntent, BoardSummarySettingsRequest } from "@/lib/boards/summary-settings";

export type BoardSummarySettingsResult =
  | { ok: true; requestId: string }
  | { ok: false; requestId: string; error: string };

function intentKey(intent: BoardSummarySettingsIntent): string {
  if (intent.type === "add") return `add:${intent.metric.id}:${intent.metric.kind}:${intent.metric.columnKey}`;
  if (intent.type === "remove") return `remove:${intent.metricId}`;
  return `move:${intent.metricId}:${intent.direction}`;
}

export function BoardSummarySettingsPopover({
  config,
  columns,
  canEdit,
  pending = false,
  error,
  onSubmit,
}: {
  config: readonly BoardSummaryMetricConfig[];
  columns: readonly BoardColumn[];
  canEdit: boolean;
  pending?: boolean;
  error?: string | null;
  onSubmit: (request: BoardSummarySettingsRequest) => Promise<BoardSummarySettingsResult>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8, width: 352, maxHeight: 520 });
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const submittingRef = useRef(false);
  const retryRef = useRef<{ key: string; request: BoardSummarySettingsRequest } | null>(null);
  const normalized = useMemo(() => normalizeBoardSummaryConfig(config), [config]);
  const candidates = useMemo(() => boardSummaryCandidates(columns, normalized), [columns, normalized]);
  const columnLabels = useMemo(() => new Map(columns.map((column) => [column.key, column.label])), [columns]);
  const busy = pending || submitting;
  const displayedError = localError ?? error;

  const submit = useCallback(async (intent: BoardSummarySettingsIntent) => {
    if (!canEdit || pending || submittingRef.current) return;
    const key = intentKey(intent);
    const retry = retryRef.current;
    const request = retry?.key === key
      ? retry.request
      : {
          requestId: crypto.randomUUID(),
          intent,
        };

    submittingRef.current = true;
    setSubmitting(true);
    setLocalError(null);
    try {
      const result = await onSubmit(request);
      if (result.requestId !== request.requestId) {
        retryRef.current = { key, request };
        setLocalError("요약 설정 응답을 확인할 수 없습니다. 다시 시도해 주세요.");
      } else if (!result.ok) {
        retryRef.current = { key, request };
        setLocalError(result.error);
      } else {
        retryRef.current = null;
      }
    } catch {
      retryRef.current = { key, request };
      setLocalError("요약 설정을 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [canEdit, onSubmit, pending]);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    const closeOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) close(false);
    };
    window.addEventListener("moawork:popover-open", closeOther);
    return () => window.removeEventListener("moawork:popover-open", closeOther);
  }, [close, id]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(352, Math.max(280, window.innerWidth - 16));
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const useAbove = below < 260 && above > below;
      const maxHeight = Math.max(240, Math.min(520, useAbove ? above : below));
      const renderedHeight = Math.min(maxHeight, panelRef.current?.scrollHeight ?? maxHeight);
      setPosition({
        left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
        top: useAbove ? Math.max(8, rect.top - renderedHeight - 4) : rect.bottom + 4,
        width,
        maxHeight,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    queueMicrotask(() => panelRef.current?.querySelector<HTMLElement>("button")?.focus());
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) window.dispatchEvent(new CustomEvent("moawork:popover-open", { detail: id }));
        }}
        className="min-h-7 shrink-0 rounded-full border border-mw-line bg-mw-card px-2 text-[0.68rem] font-semibold text-mw-body hover:bg-mw-bg"
      >
        요약 설정
      </button>
      {typeof document !== "undefined" && open ? createPortal(
        <div
          className="mw-layer-page-popover fixed inset-0"
          onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}
        >
          <div
            ref={panelRef}
            id={`${id}-panel`}
            role="dialog"
            aria-label="요약 설정"
            aria-busy={busy || undefined}
            style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}
            className="fixed flex flex-col overflow-hidden rounded-md border border-mw-line bg-mw-card text-mw-fg shadow-xl"
          >
            <header className="flex shrink-0 items-start gap-2 border-b border-mw-line px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">요약 설정</p>
                <p className="mt-0.5 text-[0.68rem] text-mw-sub">보드 공통 지표를 최대 3개까지 고르고 순서를 바꿀 수 있습니다.</p>
              </div>
              <button type="button" onClick={() => close()} aria-label="요약 설정 닫기" className="min-h-8 min-w-8 rounded-lg text-mw-sub hover:bg-mw-bg">✕</button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {!canEdit ? <p role="status" className="mb-3 rounded-lg bg-mw-bg p-2 text-xs text-mw-sub">요약 설정을 변경할 권한이 없습니다.</p> : null}
              {busy ? <p role="status" aria-live="polite" className="mb-3 rounded-lg bg-mw-bg p-2 text-xs text-mw-sub">요약 설정 저장 중…</p> : null}
              {displayedError ? <p role="alert" aria-live="assertive" className="mb-3 rounded-lg bg-mw-error/10 p-2 text-xs text-mw-error">{displayedError}</p> : null}
              <section aria-labelledby={`${id}-selected`}>
                <h3 id={`${id}-selected`} className="text-xs font-semibold">표시 중 · {normalized.length}/3</h3>
                <div className="mt-2 grid gap-1.5">
                  {normalized.length === 0 ? <p className="rounded-lg bg-mw-bg p-3 text-xs text-mw-sub">표시 중인 요약이 없습니다.</p> : normalized.map((metric, index) => (
                    <div key={metric.id} className="flex min-h-10 items-center gap-1 rounded-lg border border-mw-line px-2 text-xs">
                      <span className="min-w-0 flex-1 truncate">{columnLabels.get(metric.columnKey) ?? metric.columnKey} · {metric.kind === "sum" ? "합계" : "분포"}</span>
                      <button type="button" disabled={!canEdit || busy || index === 0} onClick={() => { void submit({ type: "move", metricId: metric.id, direction: -1 }); }} aria-label={`${columnLabels.get(metric.columnKey) ?? metric.columnKey} 위로`} className="min-h-8 min-w-8 rounded disabled:opacity-30">↑</button>
                      <button type="button" disabled={!canEdit || busy || index === normalized.length - 1} onClick={() => { void submit({ type: "move", metricId: metric.id, direction: 1 }); }} aria-label={`${columnLabels.get(metric.columnKey) ?? metric.columnKey} 아래로`} className="min-h-8 min-w-8 rounded disabled:opacity-30">↓</button>
                      <button type="button" disabled={!canEdit || busy} onClick={() => { void submit({ type: "remove", metricId: metric.id }); }} aria-label={`${columnLabels.get(metric.columnKey) ?? metric.columnKey} 요약 제거`} className="min-h-8 rounded px-2 text-mw-error disabled:opacity-30">제거</button>
                    </div>
                  ))}
                </div>
              </section>
              <section aria-labelledby={`${id}-available`} className="mt-4 border-t border-mw-line pt-3">
                <h3 id={`${id}-available`} className="text-xs font-semibold">추가할 지표</h3>
                {normalized.length >= 3 ? <p role="status" className="mt-1 text-[0.68rem] text-mw-sub">최대 3개를 사용 중입니다. 기존 지표를 제거하면 추가할 수 있습니다.</p> : null}
                <div className="mt-2 grid gap-1.5">
                  {candidates.length === 0 ? <p className="text-xs text-mw-sub">추가할 수 있는 typed 컬럼이 없습니다.</p> : candidates.map((candidate) => (
                    <button
                      key={`${candidate.kind}:${candidate.columnKey}`}
                      type="button"
                      disabled={!canEdit || busy || normalized.length >= 3}
                      onClick={() => { void submit({ type: "add", metric: { id: `${candidate.kind}:${candidate.columnKey}`, kind: candidate.kind, columnKey: candidate.columnKey } }); }}
                      className="flex min-h-10 items-center justify-between rounded-lg border border-mw-line px-3 text-left text-xs hover:bg-mw-bg disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span className="truncate">{candidate.label}</span>
                      <span className="shrink-0 text-mw-sub">{candidate.kind === "sum" ? "합계" : "분포"} 추가</span>
                    </button>
                  ))}
                </div>
              </section>
            </div>
            <footer className="flex shrink-0 justify-end border-t border-mw-line px-3 py-2">
              <button type="button" onClick={() => close()} className="min-h-9 rounded-lg bg-mw-record px-4 text-xs font-semibold text-mw-on-accent">완료</button>
            </footer>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
