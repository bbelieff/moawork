"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { WorkBoardSnapshot } from "@/lib/work-management/contracts";
import { WorkBoardSurface } from "./WorkBoardSurface";
import styles from "./work-management.module.css";

export function NotificationWorkBoard({ snapshot, highlightedItemId }: { snapshot: WorkBoardSnapshot; highlightedItemId: string | null }) {
  const root = useRef<HTMLDivElement>(null);
  const router = useRouter(); const searchParams = useSearchParams();
  useEffect(() => {
    const rowIndex = highlightedNotificationRowIndex(snapshot, highlightedItemId);
    if (rowIndex < 0 || !root.current) return;
    const row = root.current.querySelectorAll<HTMLTableRowElement>(`tbody tr:not(.${styles.groupRow})`)[rowIndex];
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

export function highlightedNotificationRowIndex(snapshot: WorkBoardSnapshot, highlightedItemId: string | null): number {
  // #547 — 표가 그리는 차례와 같아야 한다: 그룹들 다음에 «미분류» 가 온다.
  //   여기서 미분류를 빼면 알림으로 들어온 «그룹 없는 업무» 를 영영 못 짚는다.
  const groupIds = new Set(snapshot.groups.map((group) => group.id));
  const ordered = [
    ...snapshot.groups.flatMap((group) => snapshot.items.filter((item) => item.groupId === group.id)),
    ...snapshot.items.filter((item) => !item.groupId || !groupIds.has(item.groupId)),
  ];
  return ordered.findIndex((item) => item.id === highlightedItemId);
}
