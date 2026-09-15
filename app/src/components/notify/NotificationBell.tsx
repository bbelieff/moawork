"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { NotifySnapshot } from "@/lib/notify/server";
import { Badge } from "./Badge";
import { NotificationPanel } from "./NotificationPanel";

/** Realtime 이 안 될 때의 조용한 대체 주기(60초). */
const POLL_MS = 60_000;

/**
 * 상단바 🔔 — 기존 자리에 그대로 들어간다(자리를 새로 만들지 않는다).
 *
 * 갱신 전략: Supabase Realtime 구독 → 실패하면 60초 폴링으로 조용히 대체한다.
 * 어느 쪽이든 실패해도 **오류 팝업을 띄우지 않는다** — 알림은 보조 기능이라
 * 본 작업을 방해하면 안 된다.
 */
export function NotificationBell({ initial }: { initial: NotifySnapshot }) {
  const [snapshot, setSnapshot] = useState<NotifySnapshot>(initial);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return; // 조용히 무시
      const body = (await res.json()) as { data?: NotifySnapshot };
      if (body.data) setSnapshot(body.data);
    } catch {
      // 네트워크 오류도 조용히 넘긴다.
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let poll: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (poll !== null || disposed) return;
      poll = setInterval(() => void refresh(), POLL_MS);
    };

    let channel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
    try {
      const supabase = createClient();
      channel = supabase
        .channel("notify-bell")
        .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => {
          void refresh();
        })
        .subscribe((status) => {
          // 구독이 붙지 못하면 폴링으로 대체한다.
          if (status !== "SUBSCRIBED") startPolling();
        });
    } catch {
      startPolling();
    }

    return () => {
      disposed = true;
      if (poll !== null) clearInterval(poll);
      void channel?.unsubscribe();
    };
  }, [refresh]);

  // 바깥 클릭 / ESC 로 닫기.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const actionCount = snapshot.bell.kind === "count" ? snapshot.bell.count : 0;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={actionCount > 0 ? `알림 — 할 일 ${actionCount}건` : "알림"}
        className="relative flex h-9 w-9 items-center justify-center rounded-md border transition-opacity hover:opacity-80"
        style={{ background: "var(--mw-card)", borderColor: "var(--mw-line)" }}
      >
        <span aria-hidden>🔔</span>
        {snapshot.bell.kind !== "none" ? (
          <span className="absolute -right-1 -top-1">
            <Badge state={snapshot.bell} label="알림" />
          </span>
        ) : null}
      </button>

      {open ? (
        <NotificationPanel
          snapshot={snapshot}
          onClose={() => setOpen(false)}
          onChanged={refresh}
        />
      ) : null}
    </div>
  );
}
