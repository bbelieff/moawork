import type { CSSProperties } from "react";
import { TAB_ICON_PATHS, type TabIconKey } from "@/lib/boards/board-icons";

/**
 * 탭 아이콘 한 벌(#845 · 2026-10-08) — 선만 있는 24×24 그림. 색 칸·이모지 없이 currentColor 로 그린다.
 * 머리말은 22px·탭 색, 사이드바는 16px·회색(지금 탭만 진하게)으로 쓴다. 장식이므로 보조기기에서 숨긴다.
 * 훅이 없어 서버·클라이언트 어디서든 그릴 수 있다.
 */
export function TabIcon({
  name,
  size = 16,
  className,
  style,
}: {
  name: TabIconKey;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      data-tab-icon={name}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ flex: "none", ...style }}
    >
      <path d={TAB_ICON_PATHS[name]} />
    </svg>
  );
}
