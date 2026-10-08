"use client";

/**
 * 저장된 뷰 목록과 저장·이름 바꾸기·지우기 — #845 6단계 보기 줄(BoardViewBar)이 쓴다.
 * 권한은 서버(/api/tab-views)가 다시 판정한다. 여기는 요청과 목록 상태만 든다.
 */

import { useCallback, useEffect, useState } from "react";
import type { PersonScope } from "@/lib/view";
import type { SavedBoardView, SavedBoardViewConfig } from "@/lib/view/board-saved";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "뷰를 저장하지 못했어요.");
  return payload.data as T;
}

const JSON_HEADERS = { "content-type": "application/json" };

/** 주소 이동 — 시험에서 바꿔 끼울 수 있게 한곳에 둔다. */
export function navigateTo(url: string) {
  window.location.assign(url);
}

export type NewViewInput = {
  name: string;
  visibility: "private" | "shared";
  personScope: PersonScope;
  personScopeUserId: string | null;
  config: SavedBoardViewConfig;
};

export function useSavedViews(boardId: string, enabled: boolean) {
  const [views, setViews] = useState<SavedBoardView[]>([]);
  const [loaded, setLoaded] = useState(!enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    request<SavedBoardView[]>(`/api/tab-views?boardId=${encodeURIComponent(boardId)}`)
      .then((loadedViews) => {
        if (!alive) return;
        setViews(loadedViews);
        setError(null);
        setLoaded(true);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause instanceof Error ? cause.message : "저장된 뷰를 불러오지 못했어요.");
        setLoaded(true);
      });
    return () => { alive = false; };
  }, [boardId, enabled]);

  const select = useCallback(async (view: SavedBoardView) => {
    // 고른 뷰를 기억한다(다음에 이 보드를 열 때). 실패해도 여는 것은 막지 않는다.
    await request(`/api/tab-views/${view.id}`, {
      method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ selected: true }),
    }).catch(() => undefined);
  }, []);

  const create = useCallback(async (input: NewViewInput) => request<SavedBoardView>("/api/tab-views", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ boardId, ...input }),
  }), [boardId]);

  const overwrite = useCallback(async (view: SavedBoardView, config: SavedBoardViewConfig) => {
    const saved = await request<SavedBoardView>(`/api/tab-views/${view.id}`, {
      method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ config }),
    });
    setViews((current) => current.map((candidate) => candidate.id === view.id
      ? { ...candidate, config: saved?.config ?? config }
      : candidate));
    return saved;
  }, []);

  const rename = useCallback(async (view: SavedBoardView, name: string) => {
    await request(`/api/tab-views/${view.id}`, {
      method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ name }),
    });
    setViews((current) => current.map((candidate) => candidate.id === view.id ? { ...candidate, name } : candidate));
  }, []);

  const remove = useCallback(async (view: SavedBoardView) => request<{ deleted: true; fallback: SavedBoardView | null }>(
    `/api/tab-views/${view.id}`,
    { method: "DELETE" },
  ), []);

  return { views, loaded, error, setError, select, create, overwrite, rename, remove };
}

export type SavedViewsState = ReturnType<typeof useSavedViews>;
