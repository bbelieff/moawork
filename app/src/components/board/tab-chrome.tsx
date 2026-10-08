"use client";

import { createContext, useContext } from "react";

/**
 * 탭 머리말이 여는 두 표면 — 「탭 설정」 대화상자와 「휴지통으로 이동」 확인(#845 개선안, 2026-10-08).
 *
 * 머리말(BoardHeader)의 단추·제목 ▾ 메뉴가 열고, 내용은 화면(page)이 슬롯으로 넘긴다.
 * 서버 화면은 함수를 넘길 수 없으므로 열림 상태는 BoardWorkspace 가 들고 이 문맥으로 슬롯에 알려 준다.
 */

/** 탭 설정의 세 칸 — 일반(이름·아이콘·설명) · 항목(컬럼) · 단계(그룹). */
export type TabSettingsSection = "general" | "fields" | "stages";

export type TabChromeState = Readonly<{
  /** 열린 탭 설정 칸. null 이면 닫혀 있다. */
  settingsSection: TabSettingsSection | null;
  openSettings(section: TabSettingsSection): void;
  closeSettings(): void;
  /** 휴지통으로 이동 확인이 열려 있는가. */
  trashOpen: boolean;
  closeTrash(): void;
}>;

export const TabChromeContext = createContext<TabChromeState | null>(null);

/** 탭 설정·휴지통 슬롯이 열림 상태를 읽는다. BoardWorkspace 밖에서는 null. */
export function useTabChrome(): TabChromeState | null {
  return useContext(TabChromeContext);
}
