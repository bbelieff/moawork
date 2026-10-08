"use client";

/**
 * 탭 설정 대화상자 — #845 개선안(2026-10-08 대표 결정, 승인 목업 「개선안」 Settings · MobileFix 판).
 *
 *   ┌ 탭 설정 ─────┬ 일반  이름 · 아이콘 · 설명        바꾸면 바로 저장돼요  ✕ ┐
 *   │ ▣ 일반       │                                                          │
 *   │ ▤ 항목       │   (고른 칸의 내용 — 화면이 슬롯으로 넘긴다)               │
 *   │ ☰ 단계       │                                                          │
 *   └──────────────┴──────────────────────────────────────────────────────────┘
 *
 * · 옛 「⚙ 보드 설정」 펼침을 대신한다. 머리말 오른쪽 위 「탭 설정」 과 제목 ▾ 메뉴가 연다.
 * · 데스크톱은 가운데 약 820×620 창, 640px 아래는 바닥에서 올라오는 시트(위 모서리 둥글게, 화면의 88%).
 * · 모달이다 — 초점을 안으로 옮기고 가두며, Esc·바깥 누르기로 닫히고, 닫으면 연 단추로 초점이 돌아간다
 *   (BoardModalLayer). 입력칸이 고치던 글자를 되돌리는 Esc 는 그 칸이 먼저 쓴다.
 * · 칸 전환은 탭 목록(위·아래 화살표, Home·End)이다. 열림 상태와 마지막 칸은 TabChromeProvider 가 든다.
 * · 저장은 칸마다 바로 한다(저장 단추 없음). 실패한 보드 액션의 사유는 이 창 안에서도 보인다 —
 *   페이지 맨 위 배너는 이 창 뒤에 가려진다(#654 와 같은 이유).
 */

import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { BoardModalLayer } from "./BoardDialogPortal";
import { useBoardActionError } from "./BoardActionErrorContext";
import { OWNS_ESCAPE_ATTRIBUTE, useTabChrome, type TabSettingsSection } from "./tab-chrome";

const SECTION_META: Readonly<Record<TabSettingsSection, { label: string; title: string; icon: string }>> = {
  general: { label: "일반", title: "일반", icon: "M4 6h16M4 12h10M4 18h7" },
  fields: { label: "항목", title: "항목(컬럼)", icon: "M4 5h16v4H4zM4 11h16v4H4zM4 17h10" },
  stages: { label: "단계", title: "단계", icon: "M5 6h10M5 12h14M5 18h8" },
};

function escapeOwnedByField(event: KeyboardEvent): boolean {
  const target = event.target;
  return target instanceof Element && Boolean(target.closest(`[${OWNS_ESCAPE_ATTRIBUTE}="true"]`));
}

export function TabSettingsDialog({
  general,
  fields,
  stages,
  subtitles = {},
}: {
  /** 일반 — 탭 이름·아이콘·설명. 탭 관리 권한이 없으면 화면이 넘기지 않는다. */
  general?: ReactNode;
  /** 항목 — 기록 항목(컬럼) 관리. */
  fields?: ReactNode;
  /** 단계 — 그룹 순서·이름·추가. */
  stages?: ReactNode;
  /** 머리말의 칸 설명(예: 「29개」). */
  subtitles?: Partial<Record<TabSettingsSection, string>>;
}) {
  const chrome = useTabChrome();
  if (!chrome?.settingsSection) return null;
  const content: Partial<Record<TabSettingsSection, ReactNode>> = { general, fields, stages };
  const sections = chrome.settingsSections.filter((key) => content[key] != null);
  if (sections.length === 0) return null;
  const active = sections.includes(chrome.settingsSection) ? chrome.settingsSection : sections[0];
  return (
    <TabSettingsSurface
      sections={sections}
      active={active}
      content={content[active]}
      subtitle={subtitles[active]}
      initialField={chrome.settingsField}
      onSelect={chrome.selectSettingsSection}
      onClose={chrome.closeSettings}
      returnFocusRef={chrome.settingsReturnFocusRef}
    />
  );
}

function TabSettingsSurface({
  sections,
  active,
  content,
  subtitle,
  initialField,
  onSelect,
  onClose,
  returnFocusRef,
}: {
  sections: readonly TabSettingsSection[];
  active: TabSettingsSection;
  content: ReactNode;
  subtitle?: string;
  initialField: string | null;
  onSelect(section: TabSettingsSection): void;
  onClose(): void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const base = useId().replace(/:/gu, "");
  const tabId = (key: TabSettingsSection) => `${base}-tab-${key}`;
  const panelId = `${base}-panel`;
  const headingId = `${base}-heading`;
  const tabsRef = useRef<HTMLDivElement>(null);
  const actionError = useBoardActionError();

  // 처음 열 때 초점 — 고른 입력이 없으면 지금 칸의 탭에 둔다(입력은 그 칸이 스스로 잡는다).
  useEffect(() => {
    if (initialField) return;
    tabsRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    // 처음 한 번만 — 칸을 바꿀 때는 누른 탭에 초점이 이미 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const moveFocus = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = sections.length - 1;
    const next = event.key === "ArrowDown" || event.key === "ArrowRight"
      ? (index === last ? 0 : index + 1)
      : event.key === "ArrowUp" || event.key === "ArrowLeft"
        ? (index === 0 ? last : index - 1)
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? last
            : null;
    if (next === null) return;
    event.preventDefault();
    onSelect(sections[next]);
    document.getElementById(tabId(sections[next]))?.focus();
  };

  return (
    <BoardModalLayer
      label="탭 설정"
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      ownsEscape={escapeOwnedByField}
      layerClassName="items-center justify-center p-3 max-sm:items-end max-sm:p-0"
    >
      <div
        data-tab-settings-dialog
        className="flex h-[min(620px,calc(100dvh-40px))] w-[min(820px,calc(100vw-40px))] overflow-hidden rounded-[14px] border border-mw-line bg-mw-card text-mw-fg shadow-2xl max-sm:h-[88vh] max-sm:w-full max-sm:flex-col max-sm:rounded-b-none max-sm:rounded-t-[18px] max-sm:border-x-0 max-sm:border-b-0"
      >
        <span aria-hidden="true" className="mx-auto mb-1 mt-2.5 h-1 w-10 shrink-0 rounded-full bg-mw-line sm:hidden" />
        <nav
          aria-label="설정 칸"
          className="flex w-[188px] shrink-0 flex-col gap-0.5 border-r border-mw-line bg-[color:var(--mw-board-canvas)] px-2.5 py-4 max-sm:w-full max-sm:flex-row max-sm:items-center max-sm:gap-1 max-sm:overflow-x-auto max-sm:border-b max-sm:border-r-0 max-sm:bg-mw-card max-sm:px-3 max-sm:py-1.5"
        >
          <span className="px-2.5 pb-2 text-[length:var(--fs-12)] font-semibold text-mw-sub max-sm:hidden">탭 설정</span>
          <div ref={tabsRef} role="tablist" aria-label="탭 설정 칸" aria-orientation="vertical" className="flex flex-col gap-0.5 max-sm:flex-row max-sm:gap-1">
            {sections.map((key, index) => {
              const selected = key === active;
              return (
                <button
                  key={key}
                  id={tabId(key)}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={panelId}
                  tabIndex={selected ? 0 : -1}
                  data-tab-settings-section={key}
                  onClick={() => onSelect(key)}
                  onKeyDown={(event) => moveFocus(event, index)}
                  className={`flex h-9 shrink-0 items-center gap-2 rounded-lg px-2.5 text-left text-[length:var(--fs-13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mw-primary max-sm:h-10 ${selected
                    ? "bg-[color:var(--mw-accent-soft,var(--mw-tint-blue))] font-semibold text-[color:var(--mw-accent-ink,var(--mw-fg))]"
                    : "text-mw-body hover:bg-mw-card max-sm:hover:bg-[color:var(--mw-board-canvas)]"}`}
                >
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flex: "none" }}>
                    <path d={SECTION_META[key].icon} />
                  </svg>
                  {SECTION_META[key].label}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-mw-line px-5 max-sm:h-12 max-sm:px-4">
            <h2 id={headingId} className="text-[length:var(--fs-16)] font-semibold text-mw-fg">{SECTION_META[active].title}</h2>
            {subtitle ? <span className="truncate text-[length:var(--fs-12)] text-mw-sub max-sm:hidden">{subtitle}</span> : null}
            <span className="flex-1" />
            <span className="shrink-0 text-[length:var(--fs-12)] text-[color:var(--mw-tab-icon,var(--mw-record))]">바꾸면 바로 저장돼요</span>
            <button
              type="button"
              aria-label="닫기"
              onClick={onClose}
              className="grid size-8 shrink-0 place-items-center rounded-lg text-mw-sub hover:bg-[color:var(--mw-board-canvas)] hover:text-mw-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mw-primary"
            >
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true" focusable="false">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div
            id={panelId}
            role="tabpanel"
            aria-labelledby={tabId(active)}
            data-tab-settings-panel={active}
            className="min-h-0 flex-1 overflow-y-auto px-5 py-[18px] max-sm:px-4"
          >
            {actionError ? (
              <p role="alert" className="mb-3 rounded-lg border px-3 py-2 text-[length:var(--fs-13)] text-mw-fg" style={{ borderColor: "var(--mw-error)" }}>
                {actionError}
              </p>
            ) : null}
            {content}
          </div>
        </div>
      </div>
    </BoardModalLayer>
  );
}
