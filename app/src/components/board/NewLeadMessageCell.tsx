"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { ItemWithValues } from "@/lib/boards/types";
import { formatPhone } from "@/lib/format/phone";
import { BoardModalLayer } from "./BoardDialogPortal";

const MESSAGE_TEMPLATES = [
  { id: "delay", label: "상담지연", body: "안녕하세요. 상담 일정이 지연되어 안내드립니다. 담당자가 확인 후 다시 연락드리겠습니다." },
  { id: "absence", label: "간편 부재", body: "안녕하세요. 상담을 위해 연락드렸으나 연결되지 않아 안내드립니다. 확인 후 연락 부탁드립니다." },
  { id: "malicious-absence", label: "악성 부재", body: "여러 차례 연락드렸으나 연결되지 않아 상담 진행이 보류됩니다. 계속 진행을 원하시면 회신해 주세요." },
  { id: "consult-1", label: "1차 상담 안내", body: "1차 상담 내용을 확인했습니다. 다음 진행 사항은 담당자가 이어서 안내드리겠습니다." },
  { id: "confirm-2", label: "2차 확정 안내", body: "2차 상담 일정이 확정되었습니다. 담당자가 확정 내용을 다시 안내드리겠습니다." },
] as const;

const MESSAGE_VALUE_KEYS = [
  "delay_notice", "absence_notice", "malicious_absence_notice",
  "consult1_notice", "confirm2_notice",
] as const;

function lastMessageStatus(row: ItemWithValues): string {
  for (const key of MESSAGE_VALUE_KEYS) {
    const value = row.values[key];
    if (typeof value === "string" && value.trim() && !["보내기 전", "심사 전"].includes(value)) return value;
  }
  return "발송 전";
}

export function NewLeadMessageCell({ row }: { row: ItemWithValues }) {
  const menuId = useId();
  const [templateId, setTemplateId] = useState<(typeof MESSAGE_TEMPLATES)[number]["id"]>("delay");
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 288, maxHeight: 360 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const template = useMemo(
    () => MESSAGE_TEMPLATES.find((entry) => entry.id === templateId) ?? MESSAGE_TEMPLATES[0],
    [templateId],
  );
  const phone = formatPhone(typeof row.values.phone === "string" ? row.values.phone : "");
  const recipient = phone && phone !== "확인 필요" ? phone : "연락처 확인 필요";
  const ready = false;
  const status = lastMessageStatus(row);

  const closeMenu = useCallback((restoreFocus = true) => {
    setMenuOpen(false);
    if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus());
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(304, Math.max(264, window.innerWidth - 16));
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const useAbove = below < 250 && above > below;
      const maxHeight = Math.max(230, Math.min(396, useAbove ? above : below));
      const renderedHeight = Math.min(maxHeight, menuRef.current?.scrollHeight ?? maxHeight);
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: useAbove ? Math.max(8, rect.top - renderedHeight - 4) : rect.bottom + 4,
        width,
        maxHeight,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    queueMicrotask(() => menuRef.current?.querySelector<HTMLElement>("[data-message-option]")?.focus());
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeMenu();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeMenu, menuOpen]);

  return (
    <div className="flex h-7 min-w-64 items-center px-0.5 whitespace-nowrap">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={`${menuId}-menu`}
        onClick={() => setMenuOpen((current) => !current)}
        className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md border border-mw-line bg-mw-card px-2 text-left text-xs text-mw-fg hover:border-mw-sub focus:outline-none focus:ring-2 focus:ring-mw-primary/25"
      >
        <span className="shrink-0 font-semibold">{template.label}</span>
        <span aria-hidden="true" className="text-mw-sub">·</span>
        <span className="min-w-0 flex-1 truncate text-[0.68rem] text-mw-sub">{status}</span>
        <span aria-hidden="true" className="shrink-0 text-[0.58rem] text-mw-sub">▼</span>
      </button>

      {typeof document !== "undefined" && menuOpen ? createPortal(
        <div
          className="mw-layer-dialog fixed inset-0"
          onPointerDown={(event) => { if (event.target === event.currentTarget) closeMenu(); }}
        >
          <div
            ref={menuRef}
            id={`${menuId}-menu`}
            role="menu"
            aria-label="메시지 보내기"
            style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}
            className="fixed flex flex-col overflow-hidden rounded-xl border border-mw-line bg-mw-card text-mw-fg shadow-xl"
          >
            <div className="border-b border-mw-line px-3 py-2.5">
              <p className="text-sm font-semibold">메시지 보내기</p>
              <p className="mt-0.5 text-[0.68rem] text-mw-sub">보낼 문구를 고른 뒤 수신자와 내용을 확인하세요.</p>
            </div>
            <div className="min-h-0 overflow-y-auto p-1.5">
              {MESSAGE_TEMPLATES.map((entry) => {
                const selected = entry.id === templateId;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    data-message-option
                    onClick={() => setTemplateId(entry.id)}
                    className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs hover:bg-mw-bg ${
                      selected ? "bg-mw-tint-blue font-semibold text-mw-record" : ""
                    }`}
                  >
                    <span aria-hidden="true" className="w-3">{selected ? "✓" : ""}</span>
                    <span>{entry.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 border-t border-mw-line p-2">
              <Link
                href="/settings/automations#solapi"
                role="menuitem"
                onClick={() => closeMenu(false)}
                className="grid h-9 place-items-center rounded-lg border border-mw-line px-3 text-xs text-mw-sub hover:bg-mw-bg"
              >
                설정
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenu(false);
                  setConfirmOpen(true);
                }}
                className="ml-auto h-9 rounded-lg bg-mw-primary px-4 text-xs font-semibold text-mw-on-accent"
              >
                보내기
              </button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}

      {confirmOpen ? (
        <BoardModalLayer label="메시지 발송 확인" onClose={() => setConfirmOpen(false)}>
          <section className="w-[min(30rem,calc(100vw-1.5rem))] rounded-2xl border border-mw-line bg-mw-card p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-mw-record">{template.label}</p>
                <h2 className="mt-1 text-lg font-bold text-mw-fg">이대로 보내시겠습니까?</h2>
                <p className="mt-1 text-xs text-mw-sub">받는 사람 · {recipient}</p>
              </div>
              <button type="button" aria-label="발송 확인 닫기" onClick={() => setConfirmOpen(false)} className="rounded-md p-2 text-mw-sub hover:bg-mw-bg">✕</button>
            </div>
            <div className="mt-4 rounded-xl border border-mw-line bg-mw-bg p-4 text-sm leading-6 text-mw-body">{template.body}</div>
            {!ready ? (
              <p role="status" className="mt-3 rounded-lg bg-mw-tint-blue px-3 py-2 text-xs leading-5 text-mw-body">
                실제 발송 전 솔라피 API와 승인 템플릿을 자동화 설정에서 연결해야 합니다. 연결 전에는 고객에게 전송되지 않습니다.
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmOpen(false)} className="h-10 rounded-lg border border-mw-line px-4 text-sm text-mw-sub">취소</button>
              <Link href="/settings/automations#solapi" className="grid h-10 place-items-center rounded-lg border border-mw-primary px-4 text-sm font-semibold text-mw-primary">설정 열기</Link>
              <button type="button" disabled={!ready || recipient === "연락처 확인 필요"} className="h-10 rounded-lg bg-mw-primary px-4 text-sm font-semibold text-mw-on-accent disabled:cursor-not-allowed disabled:opacity-45">확인 후 보내기</button>
            </div>
          </section>
        </BoardModalLayer>
      ) : null}
    </div>
  );
}
