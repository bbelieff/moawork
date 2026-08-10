import type { BadgeState } from "@/lib/notify/types";

/**
 * 뱃지 표시 — 숫자(할 일) / 점(안 본 변화).
 * 숫자와 점은 의미가 달라 색·형태를 분명히 구분한다.
 */
export function Badge({ state, label }: { state: BadgeState; label?: string }) {
  if (state.kind === "none") return null;

  if (state.kind === "dot") {
    return (
      <span
        aria-label={label ? `${label} 안 본 변화 있음` : "안 본 변화 있음"}
        role="status"
        className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
        style={{ background: "var(--mw-people, #f2704e)" }}
      />
    );
  }

  return (
    <span
      aria-label={label ? `${label} 할 일 ${state.count}건` : `할 일 ${state.count}건`}
      role="status"
      className="inline-flex min-w-[17px] shrink-0 items-center justify-center rounded-full px-[5px] py-[1px] text-[10px] font-bold leading-[15px] tabular-nums"
      style={{ background: "#e5484d", color: "#fff" }}
    >
      {state.display}
    </span>
  );
}
