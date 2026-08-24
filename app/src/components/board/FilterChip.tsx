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
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 288, width: 224 });
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
    window.addEventListener("moawork:filter-open", closeOther);
    return () => window.removeEventListener("moawork:filter-open", closeOther);
  }, [close, id]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, Math.max(224, window.innerWidth - 16));
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const useAbove = below < 180 && above > below;
      const maxHeight = Math.max(144, Math.min(320, useAbove ? above : below));
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: useAbove ? Math.max(8, rect.top - maxHeight - 4) : rect.bottom + 4,
        maxHeight,
        width,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    queueMicrotask(() => panelRef.current?.querySelector<HTMLElement>('input,button,[tabindex]:not([tabindex="-1"])')?.focus());
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
            if (next) window.dispatchEvent(new CustomEvent("moawork:filter-open", { detail: id }));
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
            className="mw-layer-dialog fixed inset-0"
            onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}
          >
            <div
              ref={panelRef}
              id={`${id}-panel`}
              role="dialog"
              aria-label={`${label} 필터`}
              style={{ left: position.left, top: position.top, maxHeight: position.maxHeight, width: position.width }}
              className="fixed overflow-auto rounded-xl border border-mw-line bg-mw-card p-2 text-mw-fg shadow-lg"
            >
              {children}
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
    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-xs hover:bg-mw-bg">
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
