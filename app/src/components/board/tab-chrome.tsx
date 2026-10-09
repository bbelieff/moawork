"use client";

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

/**
 * 탭 머리말이 여는 두 표면 — 「탭 설정」 대화상자와 「휴지통으로 이동」 확인(#845 개선안, 2026-10-08).
 *
 * 머리말(BoardHeader)의 단추·제목 ▾ 메뉴가 열고, 내용은 화면(page)이 슬롯으로 넘긴다.
 * 서버 화면은 함수를 넘길 수 없으므로 열림 상태는 TabChromeProvider(클라이언트)가 들고 이 문맥으로
 * 머리말과 슬롯에 알려 준다. 표 보기는 BoardWorkspace 가, 칸반·달력 보기는 화면이 이 제공자로 감싼다.
 */

/** 탭 설정의 세 칸 — 일반(이름·아이콘·설명) · 항목(컬럼) · 단계(그룹). */
export type TabSettingsSection = "general" | "fields" | "stages";

export const TAB_SETTINGS_SECTIONS: readonly TabSettingsSection[] = ["general", "fields", "stages"];

/**
 * 탭 설정 대화상자 안의 입력이 Esc 를 먼저 쓰겠다는 표시(고치던 글자가 있을 때 "true").
 * 그때 Esc 는 그 글자만 되돌리고 대화상자는 닫지 않는다.
 */
export const OWNS_ESCAPE_ATTRIBUTE = "data-owns-escape";

/** 일반 칸에서 바로 초점을 줄 입력 — ▾ 의 「아이콘 바꾸기」·「설명 고치기」. */
export type TabSettingsField = "name" | "icon" | "description";

export type TabSettingsOpenRequest = Readonly<{
  /** 열 칸. 없으면 이번에 마지막으로 본 칸(처음이면 일반). */
  section?: TabSettingsSection;
  /** 일반 칸의 이 입력에 바로 초점을 준다. */
  field?: TabSettingsField;
  /** 닫으면 초점을 돌려줄 곳(연 단추). */
  opener?: HTMLElement | null;
}>;

export type TabChromeState = Readonly<{
  /** 이 탭에서 열 수 있는 설정 칸(권한·시스템 보드에 따라 화면이 정한다). 비면 「탭 설정」 이 없다. */
  settingsSections: readonly TabSettingsSection[];
  /** 열린 탭 설정 칸. null 이면 닫혀 있다. */
  settingsSection: TabSettingsSection | null;
  /** 열 때 고른 입력(일반 칸). 한 번 초점을 준 뒤에는 쓰지 않는다. */
  settingsField: TabSettingsField | null;
  /** 「탭 설정」 을 연다. 열 칸이 없으면 undefined. */
  openSettings?: (request?: TabSettingsOpenRequest) => void;
  /** 대화상자 안에서 칸을 바꾼다. */
  selectSettingsSection(section: TabSettingsSection): void;
  closeSettings(): void;
  /** 닫으면 초점을 돌려줄 곳. */
  settingsReturnFocusRef: RefObject<HTMLElement | null>;
  /** 휴지통으로 이동 확인이 열려 있는가. */
  trashOpen: boolean;
  /** 「휴지통으로 이동」 확인을 연다. 지울 권한이 없거나 시스템 보드면 undefined. */
  requestTrash?: (opener?: HTMLElement | null) => void;
  closeTrash(): void;
  trashReturnFocusRef: RefObject<HTMLElement | null>;
}>;

export const TabChromeContext = createContext<TabChromeState | null>(null);

/** 탭 설정·휴지통 슬롯과 머리말이 열림 상태를 읽는다. 제공자 밖에서는 null. */
export function useTabChrome(): TabChromeState | null {
  return useContext(TabChromeContext);
}

/** 고른 칸이 이 탭에 없으면(권한 없음) 있는 칸 중 첫째로 연다. */
export function resolveTabSettingsSection(
  wanted: TabSettingsSection | undefined,
  last: TabSettingsSection | null,
  available: readonly TabSettingsSection[],
): TabSettingsSection | null {
  for (const candidate of [wanted, last, "general" as const]) {
    if (candidate && available.includes(candidate)) return candidate;
  }
  return available[0] ?? null;
}

export function TabChromeProvider({
  settings,
  settingsSections = [],
  trash,
  children,
}: {
  /** 탭 설정 대화상자(닫혀 있으면 아무것도 그리지 않는다). */
  settings?: ReactNode;
  settingsSections?: readonly TabSettingsSection[];
  /** 휴지통으로 이동 확인. 없으면 ▾ 메뉴에서 감춘다. */
  trash?: ReactNode;
  children: ReactNode;
}) {
  const [settingsSection, setSettingsSection] = useState<TabSettingsSection | null>(null);
  const [settingsField, setSettingsField] = useState<TabSettingsField | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const lastSection = useRef<TabSettingsSection | null>(null);
  const settingsReturnFocusRef = useRef<HTMLElement | null>(null);
  const trashReturnFocusRef = useRef<HTMLElement | null>(null);
  // 배열은 렌더마다 새로 올 수 있다 — 내용이 같으면 같은 값으로 본다.
  const sectionsKey = settings ? settingsSections.join(",") : "";
  const available = useMemo(
    () => (sectionsKey ? (sectionsKey.split(",") as TabSettingsSection[]) : []),
    [sectionsKey],
  );
  const hasTrash = Boolean(trash);

  const openSettings = useCallback((request: TabSettingsOpenRequest = {}) => {
    const section = resolveTabSettingsSection(request.section, lastSection.current, available);
    if (!section) return;
    settingsReturnFocusRef.current = request.opener ?? null;
    lastSection.current = section;
    setTrashOpen(false);
    setSettingsField(section === "general" ? request.field ?? null : null);
    setSettingsSection(section);
  }, [available]);

  const selectSettingsSection = useCallback((section: TabSettingsSection) => {
    if (!available.includes(section)) return;
    lastSection.current = section;
    setSettingsField(null);
    setSettingsSection(section);
  }, [available]);

  const closeSettings = useCallback(() => {
    setSettingsField(null);
    setSettingsSection(null);
  }, []);

  const requestTrash = useCallback((opener?: HTMLElement | null) => {
    trashReturnFocusRef.current = opener ?? null;
    setSettingsSection(null);
    setTrashOpen(true);
  }, []);

  const closeTrash = useCallback(() => setTrashOpen(false), []);

  const value = useMemo<TabChromeState>(() => ({
    settingsSections: available,
    settingsSection,
    settingsField,
    openSettings: available.length > 0 ? openSettings : undefined,
    selectSettingsSection,
    closeSettings,
    settingsReturnFocusRef,
    trashOpen,
    requestTrash: hasTrash ? requestTrash : undefined,
    closeTrash,
    trashReturnFocusRef,
  }), [available, closeSettings, closeTrash, hasTrash, openSettings, requestTrash, selectSettingsSection, settingsField, settingsSection, trashOpen]);

  return (
    <TabChromeContext.Provider value={value}>
      {/* 슬롯은 서버 화면이 만든 요소다 — 자리마다 열쇠를 줘 형제 목록 경고 없이 붙인다. */}
      <Fragment key="content">{children}</Fragment>
      <Fragment key="settings">{available.length > 0 ? settings : null}</Fragment>
      <Fragment key="trash">{trash}</Fragment>
    </TabChromeContext.Provider>
  );
}
