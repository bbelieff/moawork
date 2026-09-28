"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import styles from "./board-scroll.module.css";

/** Every group shares this native scrollport, including the frozen edge cells. */
export function BoardScrollViewport({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      // Use document coordinates: resizing after a page scroll must not grow the
      // board by the scroll offset or move the page's own scroll range.
      const top = element.getBoundingClientRect().top + window.scrollY;
      element.style.setProperty("--board-available-height", `${Math.max(240, window.innerHeight - top - 16)}px`);
      element.style.setProperty("--board-visible-width", `${element.clientWidth}px`);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    if (element.parentElement) observer?.observe(element.parentElement);
    window.addEventListener("resize", measure);
    measure();
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  return (
    <div ref={ref} className={styles.viewport} data-board-scroll="shared" role="region" aria-label="보드 전체 스크롤" tabIndex={0}>
      <div className={styles.groups}>{children}</div>
    </div>
  );
}
