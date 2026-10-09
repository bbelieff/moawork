"use client";

import { useLinkStatus } from "next/link";
import { useEffect, useRef, type MouseEvent } from "react";

/**
 * Issue 857 — 누른 메뉴의 다음 화면이 올 때까지 도는 작은 표시. Link 안에서만 의미가 있다.
 * 이동이 끝나면 부모에 알린다 — 같은 주소로 돌아오는 이동(경유지 → 원래 화면)에서도 누른 표시를 내려놓게.
 * 사이드바와 휴대폰 아래 메뉴가 같이 쓴다.
 */
export function NavPending({ onSettled }: { onSettled: () => void }) {
  const { pending } = useLinkStatus();
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending) onSettled();
    wasPending.current = pending;
  }, [pending, onSettled]);
  return pending ? <span aria-hidden="true" data-nav-pending className="mw-nav-pending" /> : null;
}

/** 새 탭·새 창으로 여는 클릭은 이 화면의 이동이 아니다. */
export function isPlainClick(event: MouseEvent<HTMLElement>) {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
