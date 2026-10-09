"use client";

// 홈 «오늘» KPI 줄 — 숫자 올라가기 · 휴대폰 가로 넘김(2026-10-09 대시보드 시각 1차).
//
// ★ 서버 HTML 은 «최종 값» 을 그린다 — 스크립트가 없어도 숫자가 읽힌다.
//   올라가기는 하이드레이션 뒤 «처음 붙을 때 한 번» 만 돈다. 조용한 새로고침(router.refresh)으로
//   값이 바뀌어도 다시 돌지 않고 새 값을 그대로 보여준다.
// ★ 움직임 줄이기 설정이면 아무것도 움직이지 않는다.
// ★ 640px 미만에서만 가로 넘김 + 점 표시. 그 이상은 지금처럼 격자다.

import { useCallback, useEffect, useRef, useState } from "react";
import { formatCount, formatKrw } from "@/lib/dash/format";

export interface KpiStripItem {
  key: string;
  label: string;
  value: number;
  unit: "count" | "krw";
}

const COUNT_UP_MS = 900;
/** 가로 넘김의 scroll-padding 과 같은 값(--sp-4). */
const STRIP_PAD_PX = 16;

function format(value: number, unit: KpiStripItem["unit"]): string {
  return unit === "krw" ? formatKrw(value) : formatCount(value);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/** 처음 붙을 때 한 번 0 → 값으로 올라간다. 그 뒤로는 받은 값을 그대로 보인다. */
export function CountUp({ value, unit }: { value: number; unit: KpiStripItem["unit"] }) {
  // null = «받은 값 그대로». 서버 렌더와 첫 하이드레이션은 항상 null 이라 최종 값이 찍힌다.
  const [shown, setShown] = useState<number | null>(null);
  // 올라가는 목표는 «처음 받은 값» 이다. 도중에 값이 바뀌면 끝날 때 새 값으로 바로 바뀐다.
  const [from] = useState(value);

  useEffect(() => {
    if (prefersReducedMotion() || !Number.isFinite(from) || from === 0) return;
    let frame = 0;
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const t = Math.min(1, (now - start) / COUNT_UP_MS);
      if (t >= 1) {
        setShown(null);
        return;
      }
      setShown(Math.round(from * easeOutCubic(t)));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [from]);

  return <span data-count-up="">{format(shown ?? value, unit)}</span>;
}

const CARD =
  "rounded-[var(--mw-r-3)] border border-[var(--mw-bd)] bg-[var(--mw-s-2)] px-[var(--sp-3)] py-[var(--sp-3)]";

export function KpiStrip({ items }: { items: readonly KpiStripItem[] }) {
  const list = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);

  const cards = useCallback(
    () => Array.from(list.current?.querySelectorAll<HTMLElement>("[data-kpi-card]") ?? []),
    [],
  );

  // 보이는 카드 = 왼쪽 여백 자리에 가장 가까운 카드. 스크롤 위치로 잰다(프레임당 한 번).
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const all = cards();
      if (all.length === 0) return;
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      all.forEach((card, index) => {
        const distance = Math.abs(card.offsetLeft - STRIP_PAD_PX - el.scrollLeft);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      setActive(best);
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [cards]);

  const goTo = (index: number) => {
    const el = list.current;
    const card = cards()[index];
    if (!el || !card) return;
    el.scrollTo({ left: Math.max(0, card.offsetLeft - STRIP_PAD_PX), behavior: prefersReducedMotion() ? "auto" : "smooth" });
    setActive(index);
  };

  return (
    <div>
      <ul
        ref={list}
        data-kpi-strip=""
        className="mw-scroll-strip relative -mx-[var(--sp-4)] flex snap-x snap-mandatory scroll-px-[var(--sp-4)] gap-[var(--sp-3)] overflow-x-auto px-[var(--sp-4)] sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 xl:grid-cols-5"
      >
        {items.map((item) => (
          <li
            key={item.key}
            data-kpi-card=""
            className={`${CARD} w-[74%] shrink-0 snap-start sm:w-auto`}
          >
            <div className="text-[length:var(--fs-12)] text-[var(--mw-t-3)]">{item.label}</div>
            <div className="mt-[var(--sp-1)] text-[length:var(--fs-22)] font-semibold tabular-nums text-[var(--mw-t-1)]">
              <CountUp value={item.value} unit={item.unit} />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-[var(--sp-2)] flex justify-center gap-[var(--sp-1)] sm:hidden" data-kpi-dots="">
        {items.map((item, index) => (
          <button
            key={item.key}
            type="button"
            aria-label={`${item.label} 보기`}
            aria-current={index === active ? "true" : undefined}
            onClick={() => goTo(index)}
            className="flex h-[var(--mw-hit-min)] w-[var(--mw-hit-min)] items-center justify-center"
          >
            <span
              aria-hidden="true"
              className={`block h-[6px] w-[6px] rounded-full transition-transform duration-200 motion-reduce:transition-none ${
                index === active ? "scale-150 bg-[var(--mw-record)]" : "bg-[var(--mw-bd-2)]"
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
