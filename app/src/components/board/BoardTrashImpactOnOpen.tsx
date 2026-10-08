"use client";

import { useEffect, useRef, useState } from "react";
import type { BoardTrashImpact } from "@/lib/boards/types";
import { formatTrashImpact } from "@/lib/boards/trash-impact-format";

/**
 * «탭 삭제» 칸의 지울 내용 개수 — 감싼 «탭 설정»(details)을 열 때 한 번만 읽는다(Issue 857).
 * 못 읽어도 삭제·복구는 그대로 할 수 있다고 알린다(전과 같은 문구).
 */
type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; impact: BoardTrashImpact }
  | { kind: "error" };

export function BoardTrashImpactOnOpen({ boardId }: Readonly<{ boardId: string }>) {
  const anchor = useRef<HTMLParagraphElement>(null);
  const requested = useRef(false);
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (requested.current) return;
      requested.current = true;
      setState({ kind: "loading" });
      fetch(`/api/boards/${encodeURIComponent(boardId)}/trash-impact`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error(String(response.status));
          const body = (await response.json()) as { data?: BoardTrashImpact };
          if (!body.data) throw new Error("empty");
          if (!cancelled) setState({ kind: "ready", impact: body.data });
        })
        .catch(() => {
          if (!cancelled) setState({ kind: "error" });
        });
    };
    const details = anchor.current?.closest("details") ?? null;
    if (!details || details.open) {
      load();
      return () => {
        cancelled = true;
      };
    }
    const onToggle = () => {
      if (details.open) load();
    };
    details.addEventListener("toggle", onToggle);
    return () => {
      cancelled = true;
      details.removeEventListener("toggle", onToggle);
    };
  }, [boardId]);

  if (state.kind === "ready") {
    return (
      <p ref={anchor} className="mt-1 text-xs font-medium text-mw-body" data-testid="board-trash-impact">
        {formatTrashImpact(state.impact)}
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <p ref={anchor} className="mt-1 text-xs text-mw-sub">
        지울 내용의 개수를 불러오지 못했어요. 삭제와 복구는 그대로 할 수 있어요.
      </p>
    );
  }
  return (
    <p ref={anchor} className="mt-1 text-xs text-mw-sub" aria-live="polite">
      {state.kind === "loading" ? "지울 내용을 세는 중…" : "탭 설정을 열면 지울 내용을 세어 보여 줘요."}
    </p>
  );
}
