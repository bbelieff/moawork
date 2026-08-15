"use client";

import { useCallback, useEffect, useState } from "react";
import { BOARD_FILTER_QUERY_KEY, decodeBoardFilters, encodeBoardFilters, type BoardFilterState } from "@/components/board/filters";
import type { SavedBoardView, SavedBoardViewConfig } from "@/lib/view/board-saved";

type SaveEvent = CustomEvent<{ version?: number; filters?: BoardFilterState }>;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json() as { data?: T; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "저장된 뷰를 불러오지 못했습니다.");
  return payload.data as T;
}

export function SavedViewsController({ boardId, layout = {} }: { boardId: string; layout?: Record<string, readonly string[]> }) {
  const [views, setViews] = useState<SavedBoardView[]>([]);
  const [pending, setPending] = useState<SavedBoardViewConfig | null>(null);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setViews(await request<SavedBoardView[]>(`/api/tab-views?boardId=${encodeURIComponent(boardId)}`));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "저장된 뷰를 불러오지 못했습니다.");
    }
  }, [boardId]);

  useEffect(() => {
    request<SavedBoardView[]>(`/api/tab-views?boardId=${encodeURIComponent(boardId)}`)
      .then((loaded) => { setViews(loaded); setError(null); })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "저장된 뷰를 불러오지 못했습니다."));
  }, [boardId]);
  useEffect(() => {
    const onSave = (event: Event) => {
      const detail = (event as SaveEvent).detail;
      const url = new URL(window.location.href);
      setPending({
        kind: url.searchParams.get("view") === "kanban" ? "board" : "table",
        filters: detail?.filters ?? decodeBoardFilters(url.searchParams.get(BOARD_FILTER_QUERY_KEY)),
        groupBy: url.searchParams.get("group") ?? "",
        layout,
        calendarFieldKey: null,
      });
    };
    window.addEventListener("moawork:save-board-view", onSave);
    return () => window.removeEventListener("moawork:save-board-view", onSave);
  }, [layout]);

  const select = async (view: SavedBoardView) => {
    const url = new URL(window.location.href);
    const { config } = view;
    url.searchParams.set(BOARD_FILTER_QUERY_KEY, encodeBoardFilters(config.filters));
    url.searchParams.set("view", config.kind === "board" ? "kanban" : "table");
    if (config.groupBy) url.searchParams.set("group", config.groupBy);
    else url.searchParams.delete("group");
    await request(`/api/tab-views/${view.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ touch: true }) });
    window.location.assign(url.toString());
  };

  const create = async () => {
    if (!pending || !name.trim()) return;
    await request("/api/tab-views", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ boardId, name: name.trim(), visibility: shared ? "shared" : "private", config: pending }),
    });
    setPending(null); setName(""); setShared(false); await reload();
  };

  const remove = async (view: SavedBoardView) => {
    const result = await request<{ fallback: SavedBoardView | null }>(`/api/tab-views/${view.id}`, { method: "DELETE" });
    await reload();
    if (result.fallback) await select(result.fallback);
  };

  const rename = async (view: SavedBoardView) => {
    const next = window.prompt("새 뷰 이름", view.name)?.trim();
    if (!next || next === view.name) return;
    await request(`/api/tab-views/${view.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: next }) });
    await reload();
  };

  const duplicate = async (view: SavedBoardView) => {
    await request("/api/tab-views", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ boardId, name: `${view.name} 사본`, visibility: "private", config: view.config }),
    });
    await reload();
  };

  const toggleVisibility = async (view: SavedBoardView) => {
    await request(`/api/tab-views/${view.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ visibility: view.visibility === "private" ? "shared" : "private" }),
    });
    await reload();
  };

  return (
    <section aria-label="저장된 뷰" className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-mw-body">저장된 뷰</span>
      {views.map((view) => (
        <span key={view.id} className="inline-flex items-center rounded-full border border-mw-line bg-mw-card text-xs">
          <button type="button" onClick={() => void select(view)} className="px-2 py-1">{view.isDefault ? "★ " : ""}{view.name}{view.visibility === "private" ? " · 나만" : ""}</button>
          <button type="button" aria-label={`${view.name} 기본 뷰로`} onClick={() => void request(`/api/tab-views/${view.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ isDefault: true }) }).then(reload)} className="px-1">☆</button>
          <button type="button" aria-label={`${view.name} 이름 변경`} onClick={() => void rename(view)} className="px-1">✎</button>
          <button type="button" aria-label={`${view.name} 복제`} onClick={() => void duplicate(view)} className="px-1">⧉</button>
          <button type="button" aria-label={`${view.name} 공개 범위 변경`} onClick={() => void toggleVisibility(view)} className="px-1">◎</button>
          <button type="button" aria-label={`${view.name} 삭제`} onClick={() => void remove(view)} className="px-1.5 text-mw-sub">×</button>
        </span>
      ))}
      {views.length === 0 && !error ? <span className="text-xs text-mw-sub">저장된 뷰 없음</span> : null}
      {error ? <span role="alert" className="text-xs text-mw-error">{error}</span> : null}
      {pending ? (
        <div role="dialog" aria-label="현재 조건을 뷰로 저장" className="flex flex-wrap items-center gap-2 rounded-lg border border-mw-line bg-mw-card p-2">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="뷰 이름" aria-label="뷰 이름" className="h-8 rounded border border-mw-line px-2 text-sm" />
          <label className="text-xs"><input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} /> 회사 전체</label>
          <button type="button" disabled={!name.trim()} onClick={() => void create()} className="rounded bg-mw-record px-2 py-1 text-xs text-white">저장</button>
          <button type="button" onClick={() => setPending(null)} className="text-xs text-mw-sub">취소</button>
        </div>
      ) : null}
    </section>
  );
}
