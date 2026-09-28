"use client";

/**
 * 필터 칩 + 팝오버 (ui-guidelines 원칙 9).
 *
 * 원칙 9 가 금지하는 것은 "네이티브 select 나열"이다. 그래서 컨트롤 자체는 칩(pill)이고
 * 선택지는 팝오버 안에 둔다 — 도구줄이 항상 1줄로 유지되고, 선택 개수가 칩 위에 요약된다.
 *
 * 팝오버 열림/닫힘은 `<details name>` 의 **네이티브 배타 아코디언**에 맡긴다.
 * 바깥 클릭 감지를 직접 구현하지 않아 리스너 누수·포커스 트랩 버그가 생길 자리가 없고,
 * 키보드(Enter/Space)와 Esc 동작도 브라우저가 준다. name 을 지원하지 않는 브라우저에서는
 * 팝오버가 여러 개 열릴 뿐 기능은 그대로다(점진적 향상).
 *
 * 활성 상태는 accent **틴트**(--mw-tint-blue)로 표시한다. Coral(--mw-people)은 담당자·멘션·
 * 알림 전용이라 필터 강조에 쓰지 않는다(플레이북 §4).
 *
 * 칩 높이는 28px(UI목업_신규업체보드_v5.md 2-4: 26~28px). 플레이북의 "터치 44px+" 는 모바일
 * 탭 대상 규칙이고, 원칙 8·11 이 이 화면을 PC 전용 와이드 표(마우스 조작)로 명시하므로 여기서는
 * v5 의 밀도 기준을 따른다.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function FilterChip({
  label,
  summary,
  active,
  onClear,
  children,
}: {
  label: string;
  /** 칩 위에 붙는 현재 값 요약(예: "2개", "신청일 ↑"). 없으면 라벨만. */
  summary?: string;
  active: boolean;
  /** 활성일 때만 ×(해제) 버튼이 붙는다. */
  onClear: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 360, width: 288 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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
      const width = Math.min(288, Math.max(240, window.innerWidth - 16));
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const useAbove = below < 180 && above > below;
      const maxHeight = Math.max(196, Math.min(360, useAbove ? above : below));
      const renderedHeight = Math.min(maxHeight, panelRef.current?.scrollHeight ?? maxHeight);
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: useAbove ? Math.max(8, rect.top - renderedHeight - 4) : rect.bottom + 4,
        maxHeight,
        width,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    queueMicrotask(() => {
      const panel = panelRef.current;
      const target = panel?.querySelector<HTMLElement>("[data-filter-autofocus]")
        ?? panel?.querySelector<HTMLElement>("[data-filter-option] input,button[data-filter-option],[data-filter-body] button");
      target?.focus();
    });
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [close, open]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, open]);

  return (
    <div
      className={`relative inline-flex shrink-0 items-center rounded-full border text-xs transition-colors ${
        active
          ? "border-mw-record bg-mw-tint-blue text-mw-record"
          : "border-mw-line bg-mw-card text-mw-body hover:border-mw-sub"
      }`}
    >
      <div className="relative">
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
          className="flex min-h-11 cursor-pointer select-none items-center gap-1 rounded-full px-2.5 outline-none sm:min-h-7"
        >
          <span>{label}</span>
          {summary && <span className="font-semibold">{summary}</span>}
          <span aria-hidden="true" className="text-[0.6rem] opacity-70">
            ▼
          </span>
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
              aria-label={`${label} 필터`}
              style={{ left: position.left, top: position.top, maxHeight: position.maxHeight, width: position.width }}
              className="fixed flex flex-col overflow-hidden rounded-md border border-mw-line bg-mw-card text-mw-fg shadow-xl"
            >
              <div className="flex shrink-0 items-center gap-2 border-b border-mw-line px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-mw-fg">{label}</p>
                  <p className="text-[0.68rem] text-mw-sub">
                    {active ? `${summary ?? "값"} 선택 중` : "원하는 값을 여러 개 고를 수 있어요"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => close()}
                  aria-label={`${label} 필터 닫기`}
                  className="flex min-h-8 min-w-8 items-center justify-center rounded-lg text-mw-sub hover:bg-mw-bg hover:text-mw-fg"
                >
                  ✕
                </button>
              </div>
              <div data-filter-body className="min-h-0 flex-1 overflow-y-auto p-2">{children}</div>
              <div className="flex shrink-0 items-center gap-2 border-t border-mw-line px-2 py-2">
                <button
                  type="button"
                  disabled={!active}
                  onClick={onClear}
                  className="min-h-9 rounded-lg px-3 text-xs text-mw-sub hover:bg-mw-bg hover:text-mw-fg disabled:cursor-not-allowed disabled:opacity-40"
                >
                  선택 해제
                </button>
                <button
                  type="button"
                  onClick={() => close()}
                  className="ml-auto min-h-9 rounded-lg bg-mw-record px-4 text-xs font-semibold text-mw-on-accent"
                >
                  완료
                </button>
              </div>
            </div>
          </div>,
          document.body,
        ) : null}
      </div>

      {active && (
        <button
          type="button"
          onClick={onClear}
          aria-label={`${label} 필터 해제`}
          className="flex min-h-11 min-w-11 items-center justify-center text-sm leading-none opacity-70 hover:opacity-100 sm:min-h-7 sm:min-w-0 sm:pr-2 sm:pl-0.5"
        >
          ×
        </button>
      )}
    </div>
  );
}

/** 팝오버 안의 다중 선택 항목 1줄. */
export function CheckOption({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <label data-filter-option className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-xs hover:bg-mw-bg ${checked ? "bg-mw-tint-blue font-semibold text-mw-record" : ""}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} className="h-3.5 w-3.5" />
      <span className="truncate">{label}</span>
    </label>
  );
}

/** 팝오버 안의 단일 선택 항목 1줄. */
export function RadioOption({
  checked,
  label,
  onPick,
}: {
  checked: boolean;
  label: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      data-filter-option
      onClick={onPick}
      className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-xs hover:bg-mw-bg ${
        checked ? "font-semibold text-mw-record" : ""
      }`}
    >
      <span aria-hidden="true" className="w-3">
        {checked ? "✓" : ""}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}
