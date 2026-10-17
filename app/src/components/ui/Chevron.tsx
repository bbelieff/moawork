/**
 * 아래 화살표 — 2026-10-17 belie 확정 «B · 유리 동그라미».
 *
 * 글자(⌄ ▾ ▼)로 그리던 화살표를 한 그림으로 맞춘다.
 *  - `circle`: 접고 펴는 줄(업체 줄·접는 칸) — 작은 유리 원 안의 선 화살표, 펴지면 파랗게 위로.
 *  - `plain`: 단추·메뉴 안 — 원 없이 같은 선 화살표.
 * 장식이라 언제나 aria-hidden 이다. 펼침 상태는 감싸는 단추의 aria-expanded 가 알린다.
 */
export function Chevron({
  open = false,
  variant = "plain",
  size = 14,
  className = "",
}: {
  open?: boolean;
  variant?: "plain" | "circle";
  size?: number;
  className?: string;
}) {
  const icon = (
    <svg
      width={variant === "circle" ? 12 : size}
      height={variant === "circle" ? 12 : size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={variant === "circle" ? 2.2 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
    >
      <path d="M5.5 8l4.5 4.5L14.5 8" />
    </svg>
  );
  if (variant === "plain") {
    return (
      <span aria-hidden="true" data-mw-chevron="plain" className={`inline-flex shrink-0 text-mw-sub ${className}`}>
        {icon}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      data-mw-chevron="circle"
      data-open={open ? "true" : undefined}
      className={`inline-grid size-[22px] shrink-0 place-items-center rounded-full border shadow-sm transition-colors ${
        open
          ? "border-mw-record/30 bg-mw-tint-blue text-mw-record"
          : "border-mw-line bg-mw-card/90 text-mw-sub"
      } ${className}`}
    >
      {icon}
    </span>
  );
}
