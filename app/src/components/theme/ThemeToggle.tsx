"use client";

import { useSyncExternalStore } from "react";

// 다크/라이트 토글 — 목업 v0.3 상단바 우측 버튼.
// 상태는 3가지: "light" | "dark" 확정, 또는 미지정(=OS prefers-color-scheme 추종).
// 토글은 현재 "보이는" 테마의 반대로 확정한다(사용자 기대와 일치).
// 확정값은 <html data-theme> + localStorage 에 저장하고, 최초 페인트 전
// layout.tsx 의 인라인 스크립트가 같은 키를 읽어 깜빡임(FOUC)을 막는다.
//
// 진실의 출처는 DOM(<html data-theme>) + OS 미디어쿼리다. React state 로 복제하지 않고
// useSyncExternalStore 로 구독한다 — 그래서 (a) 다른 곳에서 data-theme 를 바꿔도 따라오고,
// (b) 사용자가 OS 테마를 바꾸면(미확정 상태일 때) 아이콘이 즉시 맞춰진다.

export const THEME_STORAGE_KEY = "mw-theme";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "light" || explicit === "dark") return explicit;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  // data-theme 변경(토글 클릭 포함)을 감지.
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => {
    mq.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

export function ThemeToggle() {
  // 서버 스냅샷은 null — 하이드레이션 전에는 중립 아이콘을 그려 마크업 불일치를 피한다.
  const theme = useSyncExternalStore<Theme | null>(
    subscribe,
    currentTheme,
    () => null,
  );

  function toggle() {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    // DOM 을 바꾸면 MutationObserver → 구독자 알림 → 리렌더.
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // 프라이빗 모드 등 저장 실패 — 이번 세션에만 적용되고 조용히 넘어간다.
    }
  }

  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      title="다크/라이트 전환"
      aria-label="다크/라이트 전환"
      aria-pressed={isDark}
      className="flex h-9 w-9 items-center justify-center rounded-xl border text-[15px]"
      style={{
        background: "var(--mw-card)",
        borderColor: "var(--mw-line)",
        color: "var(--mw-fg)",
      }}
    >
      {theme === null ? "◐" : isDark ? "☀" : "🌙"}
    </button>
  );
}
