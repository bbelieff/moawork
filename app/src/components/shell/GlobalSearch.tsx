"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SEARCH_KINDS, type SearchKind, type SearchResponse, type SearchResult } from "@/lib/search/types";
import { Icon } from "./icons";

const RECENT_KEY = "mw:recent-search:v1";
const KIND_LABEL: Record<SearchKind, string> = { board: "보드", deal: "업무", company: "회사", notice: "공지" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSearchResult(value: unknown): value is SearchResult {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.title === "string"
    && typeof value.description === "string"
    && typeof value.href === "string"
    && value.href.startsWith("/")
    && !value.href.startsWith("//")
    && !value.href.startsWith("/\\")
    && SEARCH_KINDS.includes(value.kind as SearchKind);
}

/** `jsonOk()`의 성공 envelope을 명시적으로 해제한다. 형식이 다르면 화면 이동을 하지 않는다. */
export function unwrapSearchResponse(payload: unknown): SearchResponse {
  const data = isRecord(payload) ? payload.data : undefined;
  if (!isRecord(data) || typeof data.query !== "string" || !Array.isArray(data.results) || !Array.isArray(data.recent)
    || !data.results.every(isSearchResult) || !data.recent.every(isSearchResult)) {
    throw new Error("검색 결과 형식을 확인하지 못했어요");
  }
  return data as SearchResponse;
}

/** 빠른 만들기 성공도 같은 envelope 안의 상대 경로 결과만 허용한다. */
export function unwrapCreatedSearchResult(payload: unknown): SearchResult {
  const data = isRecord(payload) ? payload.data : undefined;
  if (!isSearchResult(data)) throw new Error("만든 항목을 확인하지 못했어요");
  return data;
}

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
    setData(unwrapSearchResponse(await response.json() as unknown));
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
      const payload = await response.json() as unknown;
      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.error === "string" ? payload.error : "만들지 못했어요";
        throw new Error(message);
      }
      visit(unwrapCreatedSearchResult(payload));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "만들지 못했어요"); }
    finally { setBusy(false); }
  };

  return <>
    {/* 상단바 트리거 — 목업 v6 `.top > .search` (260px · 높이 30px · 「전체 검색」).
        lg 미만에서는 아이콘만 남겨 벨·테마·계정 자리를 뺏지 않는다(375px 에서도 눌린다).
        예전 문구 「검색하거나 빠르게 만들기」는 사이드바 220px 안에서 «만들 / 기» 로
        잘렸다 — 목업 문구가 4글자라 그 줄바꿈이 구조적으로 사라진다(BBE-194). */}
    <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label="전체 검색"
      className="flex flex-none items-center justify-center border lg:w-[var(--mw-shell-search-w)] lg:justify-start"
      style={{
        height: "var(--mw-shell-iconbtn-size)",
        minWidth: "var(--mw-shell-iconbtn-size)",
        gap: "var(--sp-2)",
        paddingInline: "var(--sp-2)",
        borderRadius: "var(--mw-r-2)",
        borderColor: "var(--mw-line)",
        background: "var(--mw-card)",
        color: "var(--mw-sub)",
        fontSize: "var(--fs-13)",
      }}>
      <Icon name="search" /><span className="hidden flex-1 text-left lg:inline">전체 검색</span>
      <kbd className="hidden border lg:inline" style={{ borderColor: "var(--mw-line)", borderRadius: "var(--mw-r-1)", paddingInline: "var(--sp-1)", fontSize: "var(--mw-shell-badge-fs)" }}>Ctrl K</kbd>
    </button>
    {open ? <div className="mw-layer-dialog fixed inset-0 flex items-start justify-center bg-black/35 p-0 md:p-8" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-label="통합 검색" className="flex h-full w-full flex-col bg-[var(--mw-card)] text-[var(--mw-fg)] shadow-lg md:h-auto md:max-h-[78vh] md:max-w-2xl md:rounded-md">
        <div className="flex items-center gap-2 border-b border-[var(--mw-line)] p-3">
          <input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(value + 1, shown.length - 1)); }
            if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)); }
            if (event.key === "Enter" && shown[active]) { event.preventDefault(); visit(shown[active]); }
          }} placeholder="보드, 업무, 회사, 공지를 검색해요" className="min-h-11 flex-1 rounded-md bg-[var(--mw-bg)] px-3 text-base outline-none focus:ring-2 focus:ring-[var(--mw-record)]" aria-label="검색어" aria-activedescendant={shown[active] ? `search-result-${active}` : undefined} />
          <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-2 text-sm">닫기</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <p className="mb-2 text-xs font-semibold text-[var(--mw-sub)]">{query.trim() ? "검색 결과" : "최근 본 항목"}</p>
          {shown.map((result, index) => <button id={`search-result-${index}`} key={`${result.kind}:${result.id}`} type="button" onMouseEnter={() => setActive(index)} onClick={() => visit(result)} className={`flex min-h-14 w-full items-center gap-3 rounded-md px-3 text-left ${active === index ? "bg-[var(--mw-bg)]" : ""}`}>
            <span className="w-10 shrink-0 text-xs font-semibold text-[var(--mw-sub)]">{KIND_LABEL[result.kind]}</span><span className="min-w-0"><span className="block truncate font-medium">{result.title}</span><span className="block truncate text-xs text-[var(--mw-sub)]">{result.description}</span></span>
          </button>)}
          {!shown.length ? <p className="rounded-md bg-[var(--mw-bg)] p-4 text-sm text-[var(--mw-sub)]">{query.trim() ? "일치하는 항목이 없어요. 아래에서 바로 만들 수 있어요." : "최근 본 항목이 없어요."}</p> : null}
          {query.trim() ? <div className="mt-4 border-t border-[var(--mw-line)] pt-3"><p className="mb-2 text-xs font-semibold text-[var(--mw-sub)]">빠른 만들기</p><div className="flex flex-wrap gap-2"><select value={createKind} onChange={(event) => setCreateKind(event.target.value as "deal" | "company")} className="min-h-11 rounded-md border border-[var(--mw-line)] bg-[var(--mw-card)] px-3"><option value="deal">업무</option><option value="company">회사</option></select><button type="button" disabled={busy} onClick={() => void create()} className="min-h-11 flex-1 rounded-md bg-[var(--mw-record)] px-4 font-semibold text-[var(--mw-on-accent)] disabled:opacity-60">{busy ? "만드는 중…" : `“${query.trim()}” 만들기`}</button></div></div> : null}
          {error ? <p role="alert" className="mt-3 text-sm text-[var(--mw-people)]">{error}</p> : null}
        </div>
      </section>
    </div> : null}
  </>;
}
