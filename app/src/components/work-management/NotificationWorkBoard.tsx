"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { WorkBoardSnapshot } from "@/lib/work-management";
import { WorkBoardSurface } from "./WorkBoardSurface";
import styles from "./work-management.module.css";

export function NotificationWorkBoard({ snapshot, highlightedItemId }: { snapshot: WorkBoardSnapshot; highlightedItemId: string | null }) {
  const root = useRef<HTMLDivElement>(null);
  const router = useRouter(); const searchParams = useSearchParams();
  useEffect(() => {
    const title = highlightedNotificationTitle(snapshot, highlightedItemId);
    if (!title || !root.current) return;
    const trigger = [...root.current.querySelectorAll<HTMLButtonElement>("tbody button")].find((button) => button.textContent?.trim() === title);
    const row = trigger?.closest("tr");
    row?.classList.add(styles.notificationHighlight);
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
    return () => row?.classList.remove(styles.notificationHighlight);
  }, [highlightedItemId, snapshot]);
  useEffect(() => {
    if (!highlightedItemId || !root.current) return;
    const observer = new MutationObserver(() => {
      if (!root.current?.querySelector(`.${styles.success}`)) return;
      const next = new URLSearchParams(searchParams); next.delete("notification");
      observer.disconnect(); router.replace(next.size ? `/work?${next}` : "/work");
    });
    observer.observe(root.current, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [highlightedItemId, router, searchParams]);
  return <div ref={root}><WorkBoardSurface snapshot={snapshot} /></div>;
}

export function highlightedNotificationTitle(snapshot: WorkBoardSnapshot, highlightedItemId: string | null): string | null {
  return snapshot.items.find((item) => item.id === highlightedItemId)?.title ?? null;
}
