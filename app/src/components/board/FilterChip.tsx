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
 */

import type { ReactNode } from "react";

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
  return (
    <div
      className={`relative inline-flex shrink-0 items-center rounded-full border text-xs transition-colors ${
        active
          ? "border-mw-record bg-mw-tint-blue text-mw-record"
          : "border-mw-line bg-mw-card text-mw-body hover:border-mw-sub"
      }`}
    >
      <details name="mw-board-filter" className="relative">
        <summary className="flex h-9 cursor-pointer select-none items-center gap-1 rounded-full px-3 outline-none list-none [&::-webkit-details-marker]:hidden">
          <span>{label}</span>
          {summary && <span className="font-semibold">{summary}</span>}
          <span aria-hidden="true" className="text-[0.6rem] opacity-70">
            ▼
          </span>
        </summary>

        <div className="absolute left-0 top-full z-30 mt-1 max-h-72 min-w-56 overflow-auto rounded-xl border border-mw-line bg-mw-card p-2 text-mw-fg shadow-lg">
          {children}
        </div>
      </details>

      {active && (
        <button
          type="button"
          onClick={onClear}
          aria-label={`${label} 필터 해제`}
          className="flex h-9 items-center pr-2.5 pl-0.5 text-sm leading-none opacity-70 hover:opacity-100"
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
    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-mw-bg">
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
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-mw-bg ${
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
