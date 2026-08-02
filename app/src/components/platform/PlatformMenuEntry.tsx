// T07 · 좌상단 회사 메뉴의 "플랫폼 관리" 진입 항목.
//
// ⚠ 스위처 컴포넌트(AccountMenu 등)는 **다른 세션 소유**라 여기서 수정하지 않는다.
//    이 파일은 그쪽에 그대로 꽂을 수 있는 조각으로만 제공한다.
//
//    스위처 담당자 배선 방법 — 메뉴 목록 **최하단 구분선 아래**에 넣는다:
//      const level = await loadAdminLevel();          // 서버 컴포넌트에서
//      <PlatformMenuEntry level={level} className={styles.menuItem} />
//
//    `level` 이 null 이면 이 컴포넌트는 **아무것도 렌더하지 않는다** —
//    비관리자에게는 구분선조차 보이지 않아야 하기 때문이다(메뉴 존재 자체를 숨긴다).

import Link from "next/link";
import type { AdminLevel } from "@/lib/platform/types";
import { canEnterConsole } from "@/lib/platform/access";

export function PlatformMenuEntry({
  level,
  className,
  onNavigate,
}: {
  /** `loadAdminLevel()` 결과. null 이면 렌더하지 않는다. */
  level: AdminLevel | null;
  /** 스위처의 메뉴 아이템 클래스를 그대로 받아 생김새를 맞춘다. */
  className?: string;
  onNavigate?: () => void;
}) {
  if (!canEnterConsole(level)) return null;

  return (
    <>
      <hr
        aria-hidden="true"
        style={{
          margin: "0.375rem 0",
          border: 0,
          borderTop: "1px solid rgba(0,0,0,0.08)",
        }}
      />
      <Link
        href="/platform"
        role="menuitem"
        data-account-menu-item
        className={className}
        onClick={onNavigate}
      >
        <span aria-hidden="true">⚙ </span>
        플랫폼 관리
      </Link>
    </>
  );
}
