"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SearchKind, SearchResponse, SearchResult } from "@/lib/search/types";

const RECENT_KEY = "mw:recent-search:v1";
const KIND_LABEL: Record<SearchKind, string> = { board: "보드", deal: "업무", company: "회사", notice: "공지" };

function readRecent(): Array<Pick<SearchResult, "kind" | "id">> {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item) => item && typeof item.kind === "string" && typeof item.id === "string").slice(0, 8) : [];
  } catch { return []; }
}

function remember(result: SearchResult) {
  const next = [{ kind: result.kind, id: result.id }, ...readRecent().filter((item) => item.kind !== result.kind || item.id !== result.id)].slice(0, 8);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

export function GlobalSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SearchResponse>({ query: "", results: [], recent: [] });
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createKind, setCreateKind] = useState<"deal" | "company">("deal");
  const shown = useMemo(() => query.trim() ? data.results : data.recent, [data, query]);

  const load = useCallback(async (value: string) => {
    const recent = readRecent().map((item) => `${item.kind}:${item.id}`).join(",");
    const response = await fetch(`/api/search?q=${encodeURIComponent(value)}&recent=${encodeURIComponent(recent)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("검색 결과를 불러오지 못했어요");
    setData(await response.json() as SearchResponse);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen(true); }
      if (event.key === "/" && !event.ctrlKey && !event.metaKey && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); setOpen(true); }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => { setError(""); void load(query).catch((reason) => setError(reason instanceof Error ? reason.message : "검색하지 못했어요")); }, 180);
    return () => clearTimeout(timer);
  }, [query, open, load]);

  const visit = (result: SearchResult) => { remember(result); setOpen(false); router.push(result.href); };
  const create = async () => {
    const title = query.trim(); if (!title) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: createKind, title }) });
      const result = await response.json() as SearchResult & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "만들지 못했어요");
      visit(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "만들지 못했어요"); }
    finally { setBusy(false); }
  };

  return <>
    <button type="button" onClick={() => setOpen(true)} className="mx-2 mb-2 flex min-h-11 items-center gap-2 rounded-xl border border-[var(--mw-border)] bg-[var(--mw-bg)] px-3 text-left text-sm text-[var(--mw-sub)]" aria-haspopup="dialog">
      <span aria-hidden>⌕</span><span className="flex-1">검색하거나 빠르게 만들기</span><kbd className="hidden rounded border px-1.5 py-0.5 text-[10px] md:inline">Ctrl K</kbd>
    </button>
    {open ? <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 p-0 md:p-8" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-label="통합 검색" className="flex h-full w-full flex-col bg-[var(--mw-card)] text-[var(--mw-fg)] shadow-2xl md:h-auto md:max-h-[78vh] md:max-w-2xl md:rounded-2xl">
        <div className="flex items-center gap-2 border-b border-[var(--mw-border)] p-3">
          <input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(value + 1, shown.length - 1)); }
            if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)); }
            if (event.key === "Enter" && shown[active]) { event.preventDefault(); visit(shown[active]); }
          }} placeholder="보드, 업무, 회사, 공지를 검색해요" className="min-h-11 flex-1 rounded-xl bg-[var(--mw-bg)] px-3 text-base outline-none focus:ring-2 focus:ring-[var(--mw-record)]" aria-label="검색어" aria-activedescendant={shown[active] ? `search-result-${active}` : undefined} />
          <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-2 text-sm">닫기</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <p className="mb-2 text-xs font-semibold text-[var(--mw-sub)]">{query.trim() ? "검색 결과" : "최근 본 항목"}</p>
          {shown.map((result, index) => <button id={`search-result-${index}`} key={`${result.kind}:${result.id}`} type="button" onMouseEnter={() => setActive(index)} onClick={() => visit(result)} className={`flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left ${active === index ? "bg-[var(--mw-bg)]" : ""}`}>
            <span className="w-10 shrink-0 text-xs font-semibold text-[var(--mw-sub)]">{KIND_LABEL[result.kind]}</span><span className="min-w-0"><span className="block truncate font-medium">{result.title}</span><span className="block truncate text-xs text-[var(--mw-sub)]">{result.description}</span></span>
          </button>)}
          {!shown.length ? <p className="rounded-xl bg-[var(--mw-bg)] p-4 text-sm text-[var(--mw-sub)]">{query.trim() ? "일치하는 항목이 없어요. 아래에서 바로 만들 수 있어요." : "최근 본 항목이 없어요."}</p> : null}
          {query.trim() ? <div className="mt-4 border-t border-[var(--mw-border)] pt-3"><p className="mb-2 text-xs font-semibold text-[var(--mw-sub)]">빠른 만들기</p><div className="flex flex-wrap gap-2"><select value={createKind} onChange={(event) => setCreateKind(event.target.value as "deal" | "company")} className="min-h-11 rounded-xl border border-[var(--mw-border)] bg-[var(--mw-card)] px-3"><option value="deal">업무</option><option value="company">회사</option></select><button type="button" disabled={busy} onClick={() => void create()} className="min-h-11 flex-1 rounded-xl bg-[var(--mw-record)] px-4 font-semibold text-[var(--mw-on-accent)] disabled:opacity-60">{busy ? "만드는 중…" : `“${query.trim()}” 만들기`}</button></div></div> : null}
          {error ? <p role="alert" className="mt-3 text-sm text-[var(--mw-people)]">{error}</p> : null}
        </div>
      </section>
    </div> : null}
  </>;
}
