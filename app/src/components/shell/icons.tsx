// 셸 아이콘 스프라이트 — D43(design-tokens.md §10): 이모지를 UI 아이콘으로 쓰지 않는다.
// 심볼 원본은 docs/design/UI목업_워크스페이스_최종_v6.html 의 <symbol id="i-*"> 를 그대로 옮겼다
// (해당 목업이 밀도·형태의 판정 기준 — 손으로 다시 그리지 않고 실측 그대로 포팅했다).
// sun/moon/circle-half 3종은 목업에 없어(테마 토글은 목업 범위 밖) 같은 스타일로 새로 그렸다.

const PATHS: Record<string, string> = {
  new: '<path d="M3 7h18M3 12h18M3 17h11"/><circle cx="19" cy="17" r="2.5"/>',
  contact:
    '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A15 15 0 0 1 4 5a1 1 0 0 1 1-1Z"/>',
  work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"/>',
  company:
    '<path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M15 21V10h3a2 2 0 0 1 2 2v9M3 21h18M8 7h3M8 11h3M8 15h3"/>',
  notice: '<path d="M4 9v6h3l6 4V5L7 9H4Z"/><path d="M17 9a4 4 0 0 1 0 6"/>',
  vendor: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M12 9v7M8.5 12.5h7"/>',
  topco:
    '<path d="M8 3h8v5.5a4 4 0 0 1-8 0V3Z"/><path d="M8 5H5.5v1.2A3.3 3.3 0 0 0 8.2 9.4M16 5h2.5v1.2a3.3 3.3 0 0 1-2.7 3.2"/><path d="M12 12.5V16M9.5 20h5l-.6-4h-3.8L9.5 20Z"/>',
  acct: '<path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4L6 21V3Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  addons:
    '<path d="M10 4h4v3a2 2 0 0 0 4 0V4h2v6h-3a2 2 0 0 0 0 4h3v6h-6v-3a2 2 0 0 0-4 0v3H4v-6h3a2 2 0 0 0 0-4H4V4h6Z"/>',
  org: '<rect x="8" y="3" width="8" height="5" rx="1"/><path d="M12 8v4M6 20v-6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6"/><path d="M4 20h4M16 20h4"/>',
  preset: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5M3 17l9 5 9-5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>',
  "circle-half": '<circle cx="12" cy="12" r="9"/><path d="M12 3v18"/>',
};

export type IconName = keyof typeof PATHS;

/** 한 번만 렌더 — 셸 루트(레이아웃)에서 호출한다. 개별 아이콘은 <Icon name="…"/> 로 참조. */
export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {Object.entries(PATHS).map(([name, path]) => (
          <symbol
            key={name}
            id={`i-${name}`}
            viewBox="0 0 24 24"
            dangerouslySetInnerHTML={{ __html: path }}
          />
        ))}
      </defs>
    </svg>
  );
}

type IconProps = {
  name: IconName;
  className?: string;
  "aria-hidden"?: boolean;
};

// D43 스펙: 16px · 선 굵기 1.6 · currentColor · 채우기 없음(monoline). 값은 --mw-icon-* 토큰 참조.
export function Icon({ name, className, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      aria-hidden={rest["aria-hidden"] ?? true}
      style={{
        width: "var(--mw-icon-size)",
        height: "var(--mw-icon-size)",
        flex: `0 0 var(--mw-icon-size)`,
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "var(--mw-icon-stroke)",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        verticalAlign: "-3px",
      }}
    >
      <use href={`#i-${name}`} />
    </svg>
  );
}
