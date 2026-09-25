"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const LATEST = "https://salesptlog.online/news/latest";
const REFRESH_AFTER_MS = 5 * 60 * 1000;

/** Latest issue stays inside the authenticated workspace shell. */
export function PolicyNews() {
  const root = useRef<HTMLElement>(null);
  const lastRefresh = useRef(0);
  const [revision, setRevision] = useState(0);
  const [delayed, setDelayed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(() => {
    lastRefresh.current = Date.now();
    setDelayed(false);
    setRevision(lastRefresh.current);
  }, []);

  useEffect(() => {
    const resize = () => {
      if (root.current) root.current.style.height = `${Math.max(360, window.innerHeight - root.current.getBoundingClientRect().top - 12)}px`;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    lastRefresh.current = Date.now();
    const check = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRefresh.current >= REFRESH_AFTER_MS) refresh();
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [refresh]);

  useEffect(() => {
    timer.current = setTimeout(() => setDelayed(true), 15000);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [revision]);

  return (
    <section ref={root} className="flex min-h-[360px] flex-col" style={{ height: "calc(100dvh - 120px)" }} aria-label="정책자금뉴스">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-mw-line pb-2">
        <h1 className="text-base font-semibold text-mw-fg">정책자금뉴스</h1>
        <div className="flex items-center gap-3 text-xs text-mw-sub">
          <button type="button" onClick={refresh} className="rounded px-2 py-1.5 hover:bg-mw-bg focus-visible:outline-2">새로고침</button>
          <a href={LATEST} target="_blank" rel="noopener noreferrer" className="rounded px-2 py-1.5 hover:bg-mw-bg focus-visible:outline-2">원문 열기 ↗</a>
        </div>
      </header>
      {delayed ? <p role="status" className="py-2 text-xs text-mw-sub">로딩이 지연되고 있습니다. 새로고침하거나 원문을 열어 주세요.</p> : null}
      <iframe
        key={revision}
        title="정책자금뉴스 최신호"
        src={revision ? `${LATEST}?t=${revision}` : LATEST}
        className="min-h-0 w-full flex-1 border-0 bg-white"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads"
        onLoad={() => { if (timer.current) clearTimeout(timer.current); setDelayed(false); }}
      />
    </section>
  );
}
