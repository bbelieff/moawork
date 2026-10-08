"use client";

/**
 * 터치 «길게 누르기» — #845(2026-10-08) 행 메뉴를 손가락으로도 연다.
 *
 * iOS Safari 는 길게 눌러도 contextmenu 를 보내지 않는다. 그래서 터치 포인터가 약 0.5초 동안
 * 거의 움직이지 않으면(스크롤·끌기가 아니면) 우클릭과 같은 메뉴를 연다.
 *   · 마우스·펜은 건드리지 않는다 — 그쪽은 원래 우클릭이 있다.
 *   · 손가락이 10px 넘게 움직이거나, 떼거나, 브라우저가 스크롤로 가져가면(pointercancel) 취소한다.
 *   · 메뉴가 열린 뒤 손을 떼면 그 자리의 click(업체명 → 상세 열기)은 삼킨다.
 *   · 안드로이드처럼 브라우저가 길게 누르기에 contextmenu 도 보내면, 한 몸짓에 메뉴는 한 번만 연다.
 *   · 글자를 고치는 칸에서는 시작하지 않는다(그 칸의 기본 동작 — 글자 고르기·붙여넣기 — 을 둔다).
 */

import { useCallback, useEffect, useRef } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

export const TOUCH_LONG_PRESS_MS = 500;
/** 이만큼(px) 넘게 움직이면 길게 누르기가 아니라 스크롤·끌기로 본다. */
export const TOUCH_LONG_PRESS_SLOP = 10;
/** 손을 뗀 뒤 이 시간(ms) 안의 click 하나를 삼킨다. */
const SUPPRESS_CLICK_MS = 600;

/** 행 우클릭 메뉴와 같은 기준 — 글자를 고치는 칸은 그 칸의 기본 동작을 둔다. */
export const LONG_PRESS_IGNORE_SELECTOR = 'input:not([type="checkbox"]),textarea,select,[contenteditable="true"]';

type Press = {
  pointerId: number;
  x: number;
  y: number;
  timer: number | null;
  /** 이 몸짓에서 메뉴가 이미 열렸다(우리 타이머든 브라우저 contextmenu 든). */
  opened: boolean;
};

export type TouchLongPressHandlers<E extends HTMLElement> = {
  onPointerDown(event: ReactPointerEvent<E>): void;
  onPointerMove(event: ReactPointerEvent<E>): void;
  onPointerUp(event: ReactPointerEvent<E>): void;
  onPointerCancel(event: ReactPointerEvent<E>): void;
  onClickCapture(event: ReactMouseEvent<E>): void;
};

export function useTouchLongPress() {
  const press = useRef<Press | null>(null);
  const suppressClickUntil = useRef(0);

  const cancel = useCallback(() => {
    const current = press.current;
    if (current?.timer !== null && current?.timer !== undefined) window.clearTimeout(current.timer);
    press.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  /**
   * 행 하나에 붙일 처리기. open 은 우클릭과 같은 메뉴를 누른 자리(clientX/Y)에 연다.
   * 끌기(dragstart)가 시작되면 부르는 쪽이 cancel() 을 불러 준다.
   */
  const bind = useCallback(<E extends HTMLElement>(
    open: (point: { clientX: number; clientY: number }, target: HTMLElement) => void,
  ): TouchLongPressHandlers<E> => {
    const end = (event: ReactPointerEvent<E>) => {
      const current = press.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (current.opened) suppressClickUntil.current = Date.now() + SUPPRESS_CLICK_MS;
      cancel();
    };
    return {
      onPointerDown(event) {
        cancel();
        suppressClickUntil.current = 0;
        if (event.pointerType !== "touch" || event.isPrimary === false) return;
        const target = event.target as HTMLElement;
        // 행 «안» 의 DOM 에서 누른 것만 — 칸이 띄운 포털(상세·선택지 팝오버)에서 올라온 것은 아니다.
        if (!event.currentTarget.contains(target)) return;
        if (target.closest(LONG_PRESS_IGNORE_SELECTOR)) return;
        const { clientX, clientY, pointerId } = event;
        const timer = window.setTimeout(() => {
          const current = press.current;
          if (!current || current.pointerId !== pointerId || current.opened) return;
          current.timer = null;
          current.opened = true;
          // iOS 가 길게 누른 글자를 골라 두었으면 지운다 — 메뉴만 남긴다.
          window.getSelection?.()?.removeAllRanges();
          open({ clientX, clientY }, target);
        }, TOUCH_LONG_PRESS_MS);
        press.current = { pointerId, x: clientX, y: clientY, timer, opened: false };
      },
      onPointerMove(event) {
        const current = press.current;
        if (!current || current.opened || current.pointerId !== event.pointerId) return;
        if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > TOUCH_LONG_PRESS_SLOP) cancel();
      },
      onPointerUp: end,
      onPointerCancel: end,
      onClickCapture(event) {
        if (Date.now() >= suppressClickUntil.current) return;
        if (!event.currentTarget.contains(event.target as Node)) return;
        suppressClickUntil.current = 0;
        event.preventDefault();
        event.stopPropagation();
      },
    };
  }, [cancel]);

  /**
   * contextmenu 가 왔을 때 먼저 부른다. true 면 이 몸짓에서 메뉴가 이미 열렸으니 다시 열지 않는다
   * (기본 메뉴만 막는다). false 면 평소처럼 연다 — 길게 누르는 중이었다면 우리 타이머는 거두고,
   * 손을 뗄 때의 click 은 삼킨다.
   */
  const takeContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>): boolean => {
    const current = press.current;
    if (!current) return false;
    if (current.opened) {
      event.preventDefault();
      return true;
    }
    if (current.timer !== null) window.clearTimeout(current.timer);
    current.timer = null;
    current.opened = true;
    return false;
  }, []);

  return { bind, cancel, takeContextMenu };
}
